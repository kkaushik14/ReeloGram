# Super Admin actions: receiving adapter and controller handoff

ReeloGram v1.2.0 adds four optional actions. This document is the handoff for the **Super Admin Development** chat; this change does not edit its repository, implement its UI, or enable production writes. Existing reads continue to work. API v1 and signature protocol v2 remain compatible.

## Activation and trust boundary

Keep `REELOGRAM_ADMIN_ACTIONS_ENABLED=0` until the controller below is implemented and tested. ReeloGram requires the existing admin configuration plus these server-only values:

```dotenv
REELOGRAM_ADMIN_ACTIONS_ENABLED=1
REELOGRAM_ADMIN_WRITE_KEY_ID=write-unique-rotation-id
REELOGRAM_ADMIN_WRITE_SECRET=<new-independent-random-secret>
REELOGRAM_ADMIN_OWNER_ID=<stable-owner-subject>
REELOGRAM_ADMIN_ACTIONS=accounts.suspend,accounts.restore,videos.hide,videos.restore
```

Provision at least 32 random bytes for the write secret. It must differ from active/previous read and session secrets. Use distinct values per environment and a distinct key ID; never put secrets in a browser, public environment variable, URL, logs or repository. The controller should introduce separate server-side write credentials, not repurpose its existing read pair. The read key never grants actions. Missing/invalid write configuration returns generic 404 and leaves the read manifest functional. An explicit subset of actions is permitted; no wildcard/default allowlist exists.

`REELOGRAM_ADMIN_OWNER_ID` must match the control app's stable, verified Google owner subject (agree the exact representation, for example `google:<sub>`). The controller must verify owner identity, verified email/subject allowlisting and fresh Google reauthentication, and derive `actor` and `authorizedAt` server-side. ReeloGram checks the signed assertion against its configured owner and a five-minute age window (30 seconds of future clock tolerance). **It does not independently validate a Google ID token.** A stolen write key can forge this assertion and exercise its allowlisted actions. Protect/revoke this credential as privileged infrastructure access; 404 responses are not the security boundary.

Disable actions or replace/remove the write pair to revoke access; write keys intentionally have no overlapping previous-key grace period. Restart/redeploy after changing environment variables and disable accessible old deployments. Disabling writes does not undo existing moderation or disable enforcement. MongoDB must support transactions (Atlas replica sets do); there is no nontransactional fallback.

## Controller work required in the other repository

1. Keep the integration's read connector and customer-site APIs separate from the action client. Store write credentials server-side and enable UI actions only when both local support and the remote manifest advertise them.
2. Extend account/video DTOs with nonnegative integer `revision`, plus `suspended`/`hidden` statuses. Legacy documents are reported with revision 0. Jobs remain read-only. Lists are still capped at 100; do not invent target IDs or offer unsupported bulk actions.
3. Offer only suspend/restore account and hide/restore video. Show the exact target and consequences, collect a 5–500-character reason, require deliberate confirmation and fresh owner Google reauthentication. Render user labels/reasons as text. Enforce server-side owner authorization, CSRF/origin protection and rate limits on controller routes; hidden buttons alone provide no protection.
4. Persist an outbound command record **before dispatch**, with UUID, actor, action, target, reason, expected revision and lifecycle state. Do not trust any browser-supplied actor, authorization timestamp, project, URL or credential. Restrict outbound URLs to the existing registered/allowlisted origin, reject redirects, bound response sizes/timeouts, and keep all signing on the server.
5. Implement receipt reconciliation and safe retries below. Refresh the selected record after a stale-revision rejection and ask the owner to review it again. A new intent needs a new command ID and confirmation. A retry of an uncertain intent must keep its original ID and intent.
6. Maintain the controller's own attempt audit (owner, target, reason, command, dispatch/response/reconciliation status), including denied UI attempts and transport failures. Never log secrets, signatures, raw tokens or complete request headers. ReeloGram's receipt provides the durable business outcome, not proof of independent Google authentication or tamper-proof storage against a database administrator.
7. Test non-owner/unverified/stale-session access, CSRF, body/path/project tampering, replay, stale revisions, duplicate clicks, ambiguous timeouts, reconciliation after restart, disabled actions and dependency failures. Then provision the separate credentials/owner ID in both projects and explicitly enable the chosen capabilities. Do not change ReeloGram's read credentials or use its MongoDB/ImageKit credentials in Super Admin.

## Dispatch protocol

`POST /api/admin/v1/actions`, `Content-Type: application/json`, no query string or compressed body. UTF-8 body maximum 8192 bytes, read deadline five seconds. Exactly these fields are accepted:

```json
{
  "commandId": "52e698c9-76d0-4bcc-a654-bd9ff965418f",
  "action": "accounts.suspend",
  "target": "0123456789abcdef01234567",
  "reason": "Verified violation of the community rules",
  "actor": "google:configured-owner-subject",
  "expectedRevision": 0,
  "authorizedAt": 1793923200
}
```

The example IDs/time are placeholders. Use a fresh lowercase UUID v4 for a new command and a lowercase 24-hex MongoDB target ID obtained from the read API. `authorizedAt` is Unix seconds from actual owner reauthentication, not a timestamp fabricated on every request. `expectedRevision` is the last reviewed target revision (integer 0–2147483646). The reason is trimmed, must have at least five characters after trimming, at most 500 before trimming, and contain no control characters. Unknown fields/operators/actions are rejected.

Use the existing v2 header names and timestamp/nonce rules, but `X-Admin-Scope: actions` and the independent write key ID/secret. Sign the exact serialized raw body, not a separately reconstructed object:

```text
JSON.stringify(["reelogram-admin","2","actions",projectId,environment,audience,writeKeyId,"POST","/api/admin/v1/actions",time,freshNonce,sha256Hex(rawBody)])
```

HMAC-SHA256 produces lowercase hex. `time` is a ten-digit string within ±60 seconds; `freshNonce` is a new lowercase UUID v4 for **every network attempt**, including receipt reads. Nonces share the existing project-wide store across read/write keys. Customer cookies, bearer tokens, read keys, changed signed bytes or accepted nonces cannot authorize an action. Unknown methods/paths and failed authorization return generic 404.

## Receipts, errors and retries

HTTP 200 means a terminal receipt, **not necessarily a successful action**:

```json
{
  "commandId": "52e698c9-76d0-4bcc-a654-bd9ff965418f",
  "action": "accounts.suspend",
  "target": "0123456789abcdef01234567",
  "status": "succeeded",
  "code": "applied",
  "changed": true,
  "revision": 1,
  "completedAt": "2026-11-06T10:00:00.000Z"
}
```

- `succeeded`: `applied` or `already-in-state`. A no-op does not increment revisions or revoke additional sessions.
- `rejected`: `stale-revision`, `target-not-found`, or `deletion-in-progress`; no target change. Missing targets return null revision.
- 400: structurally invalid input; no command receipt.
- 404: concealed authorization/configuration/allowlist/replay failure. Do not blindly retry.
- 409: command ID already belongs to different intent. Stop and investigate; never overwrite its saved command.
- 429: authenticated rate limit, with retry guidance. Separate policies: 30 actions/project/minute, 60/trusted network; receipt reads 120/project/minute, 300/network.
- 503 or network timeout: outcome may be uncertain. Preserve the same command and reconcile. Dependency failures fail closed; no fresh fallback counters when configured Redis is unavailable or over quota.

Reconcile using `GET /api/admin/v1/actions/<commandId>` with write key, `actions` scope, exact path, empty body and fresh signed timestamp/nonce. A present receipt returns the same DTO. A 404 does **not** prove no change: it may mean missing receipt, disabled/revoked access, or a command still in flight. Do not create a new command to work around an uncertain result. Bounded retries of the original intent use a fresh nonce and, if necessary, renewed real owner reauthentication with a new `authorizedAt`. Intent identity includes command/action/target/trimmed reason/actor/expected revision; authorization time is deliberately excluded.

Receipts in `admincommands` and record changes commit in the same MongoDB transaction with majority acknowledgement. Audit failure rolls back the action. Concurrent identical commands produce one receipt and one transition; different commands with stale revisions are rejected. Receipts have no TTL and cannot be edited/deleted through this API: expiring their IDs would allow historical commands to execute again. Persisted fields include project, command/digest, actor/credential ID, action/target/reason, authorization/completion times, before/after state and revision. They exclude credentials, nonce, email/DOB, media details and authentication tokens. Restrict database/backup access and define operator retention procedures that preserve idempotency. This is an application-immutable audit, not a WORM ledger.

## Enforcement and limitations

- Suspension blocks new credential/completion sign-ins, invalidates existing sessions through session-version changes, clears outstanding password-reset/sign-in grants, and blocks publishing. Publication and suspension serialize on the user inside MongoDB transactions, including an upload that began earlier. Restoring also increments the session version: old sessions stay invalid. Email/parent verification and existing profile restrictions remain intact.
- Previously published content is not automatically hidden when its uploader is suspended. Hide individual videos separately. Suspension/restore sends no email and deletes no account/media data.
- Hidden videos disappear from public Browse/Reels feeds, showcase, single-video API/pages/metadata and video sitemaps. Owners can still manage their hidden posts; ordinary editing cannot clear the moderation field. Restore preserves placement, so archived videos stay archived; deletion-pending videos cannot be restored by moderation.
- Video mutations invalidate public-cache generations before commit. In-flight cache fills cannot repopulate the current generation with old data. Configured cache failure before mutation prevents the write; post-commit cleanup failure leaves a short bypass lease. Already rendered pages/downloaded content cannot be recalled.
- Hiding is application visibility, not ImageKit asset revocation. Known public ImageKit URLs remain usable. Already issued direct-upload grants also cannot be recalled at ImageKit; suspended users cannot attach the result to a new post. Stronger media access control would require a separate signed/private delivery design.
- The 20-second transaction bounds keep mutations inside the existing 120-second cache fence. Provider/media requests are outside the publication transaction. No new UI, media operations or side effects run on an admin action.

## Testing and rollout

```sh
npm test
npm run lint
npm run build
npm run typecheck
npm run test:admin -- --production
npm run test:admin-actions -- --production
npm run test:e2e
```

Integration tests use disposable MongoDB replica sets, synthetic credentials and isolated servers. They do not moderate production users/videos. Stop the normal dev server before builds and restore it on port 3000 afterward. Do not run isolated suites concurrently because they share generated test configuration.

Deploying this code alone leaves existing production access read-only. Release notes stay local and unpublished. Rollback needs care **after any moderation has been applied**: v1.1.0 does not enforce these flags. Prefer disabling action dispatch while retaining this enforcement code; do not roll back to a version that silently re-enables suspended accounts or hidden videos. Restoring an account/video is a deliberate audited command, not a deployment side effect.
