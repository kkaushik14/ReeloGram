# Read-only Super Admin integration

The resource API remains **v1**, with **request-signing protocol v2**. Old signatures are deliberately rejected; upgrade the receiving adapter and the Super Admin connector together before enabling access. Application release versions are independent of both. The adapter defaults to disabled, ignores customer sessions, and exposes no write operations. Installing code does not provision credentials or enable production.

## Configuration

Configure server-only values in the intended ReeloGram environment:

```dotenv
REELOGRAM_ADMIN_ENABLED=1
REELOGRAM_ADMIN_PROJECT_ID=reelogram
REELOGRAM_ADMIN_ENVIRONMENT=production
REELOGRAM_ADMIN_AUDIENCE=https://your-exact-app-host.example
REELOGRAM_ADMIN_KEY_ID=read-2026-01
REELOGRAM_ADMIN_SECRET=<independent-random-secret>
```

The environment must be `local`, `staging` or `production`; Vercel Production requires `production` and Preview requires `staging`. The audience is the exact origin with no trailing slash, path, query, credentials or fragment. HTTPS is required except for explicit local loopback origins, such as `http://localhost:3000`. The audience comes from server configuration, never Host or forwarded headers. Use different project IDs, credentials and origins for each environment. Configuration cannot detect an operator copying a secret between independent deployments; provisioning must keep them separate.

Use a newly generated random secret with at least 32 characters (e.g. 32 random bytes encoded as hex). Never reuse authentication/provider credentials; the adapter explicitly rejects reuse of `REELOGRAM_NEXTAUTH_SECRET`. Do not prefix it with `NEXT_PUBLIC_`, put it in a URL/browser form, or commit it. Only the Super Admin server signs requests. Its Google owner authentication and independent database must be verified separately before live use.

Super Admin requires matching `SUPERADMIN_PROJECT_<SLUG_UPPERCASE_WITH_UNDERSCORES>_SECRET` and `_KEY_ID` values. Its project record supplies the matching project ID, environment and exact origin; its HTTPS hostname must also be allowlisted. It does not need ReeloGram's MongoDB, ImageKit, email or Redis credentials. Local connections retain the control app's development-only loopback gates. These checks do not make a leaked signing key harmless: it grants the supported read access until revoked.

Disabled or invalid configuration is concealed with the same generic 404 as failed authorization. No automatic legacy/default credential fallback exists. The changed required settings must be provisioned before existing local integrations can reconnect; this change does not edit `.env.local` or Vercel settings.

## Rotation and revocation

Only one active and one optional previous credential can be accepted. For a planned rotation:

1. Generate a new secret and a unique key ID. On ReeloGram, replace the active pair and put the old pair into `REELOGRAM_ADMIN_PREVIOUS_KEY_ID` and `REELOGRAM_ADMIN_PREVIOUS_SECRET`.
2. Set `REELOGRAM_ADMIN_PREVIOUS_VALID_UNTIL` to an absolute UTC deadline in `YYYY-MM-DDTHH:MM:SSZ` format, no more than 24 hours ahead. Deploy the adapter configuration, then switch the Super Admin sender to the new pair.
3. Verify the new pair, then remove all three previous-key settings and deploy. Expiry is enforced on every request even if old settings remain. An expired key cannot use a fresh timestamp to extend its access.

For a suspected compromise, do **not** configure an overlap: remove the old key immediately and replace it, or set `REELOGRAM_ADMIN_ENABLED=0`. Environment changes require a new deployment/restart; they do not revoke credentials in already running older deployments. Disable/remove publicly reachable old deployments too. Disconnecting in Super Admin alone is not revocation. Both keys share project rate counters and the same nonce namespace, so rotating keys cannot reset limits or replay accepted requests.

## Endpoints and limits

| GET endpoint             | Response                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `/api/admin/v1/manifest` | `projectId`, API `version: "1"`, and exactly `accounts.read`, `videos.read`, `jobs.read`        |
| `/api/admin/v1/accounts` | Account ID, display name, verification/profile/parent-pending status and publishing eligibility |
| `/api/admin/v1/videos`   | Video ID, title, placement summary and published/archived/deletion-pending status               |
| `/api/admin/v1/jobs`     | Unexpired pending/sending/failed notification outbox IDs, status and attempt count              |

Lists return `{items:[{id,label,detail,status}],truncated:boolean}`, at most 100 records in descending ID order, with database projections and a three-second query timeout. `truncated` indicates additional records, not a full count. Super Admin accepts but does not yet display the flag. Search, filters, cursors and full operational health remain future extensions. Query strings are rejected, never silently ignored.

No email addresses, exact DOB, parent contacts, passwords, session/reset/confirmation grants, media URLs, ImageKit IDs, uploader details, job recipients/subjects/bodies or provider credentials appear in responses. The jobs endpoint only reads notification outbox summaries; it never sends, claims or retries jobs. User-supplied names/titles are plain text; consumers must not render them as HTML.

POST/PATCH/PUT/DELETE, HEAD and OPTIONS all return generic 404 without `Allow`. Unknown admin paths also return 404. No write capabilities, actions, suspension, moderation, deletion, job retries or blocklist refresh exist. Future write integration requires a separately designed permission/owner-reauthorization flow; a read credential must not silently gain write powers.

## Request signing

Every GET must carry:

- `X-Admin-Version: 2` and `X-Admin-Scope: read`.
- `X-Admin-Project`, `X-Admin-Environment`, `X-Admin-Audience`, `X-Admin-Key-Id` matching configured values.
- `X-Admin-Time`: ten-digit Unix seconds within ±60 seconds.
- `X-Admin-Nonce`: fresh canonical lowercase UUID v4.
- `X-Admin-Signature`: lowercase hex HMAC-SHA256 with the selected credential.

The HMAC input is the UTF-8 encoding of this positional JSON array, serialized with `JSON.stringify` and no extra whitespace:

```text
["reelogram-admin","2","read",projectId,environment,audience,keyId,method,fullPath,time,nonce,sha256Hex(rawBody)]
```

The last component is the lowercase SHA-256 digest of the empty string for GET. Only GETs to the four exact paths are accepted; nonempty bodies, query strings, unsupported scope/version, malformed or duplicate-combined headers and wrong identities are rejected. Constant-time equality compares the signature. Changing a signed field invalidates it. Neither customer cookies nor bearer tokens authorize access. There is no permissive CORS policy.

All failed authorization, tampering, expiry and replay responses are `{ "error": "Not found" }` with status 404. This reduces disclosure but does not hide the route from source-code readers or replace cryptographic authorization. HTTP infrastructure may reject malformed wire requests before the application runs. Only verified callers receive operational 429/503 responses.

## Rate limits, replay protection and audit

Signature validation precedes Redis/Mongo access. Valid signatures enter the dedicated `admin-read` rate policy: 120/project/minute and 300/trusted-network/minute across resources and credential IDs. Hosting-level request protection is still needed for unsigned floods; do not trust arbitrary forwarded IP headers or add an unbounded in-memory limiter.

Nonce hashes are atomically inserted into MongoDB `adminnonces` with majority acknowledgement and a unique ID. The namespace is project-wide, including rotated keys. A 121-second TTL covers the entire inclusive timestamp window. TTL deletion may happen later; time validation always applies. Replays are denied across simultaneous requests, resources, process restarts and key rotation. Security counters/nonces are written; customer, media and notification records remain read-only.

Configured Redis failures never fall back to fresh Mongo counters. Redis quota/outage, database or nonce-store failures block reads with sanitized 503 and `Retry-After`. Authenticated rate limits return 429 and retry guidance. Every adapter response has `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, and `Referrer-Policy: no-referrer`. Admin data never enters public caches.

`lib/admin/audit.ts` emits structured server logs for verified callers: timestamp, project, environment, credential ID, allowlisted resource and HTTP status. This includes completed reads, replay denial, throttling and operational failures. It never logs headers, signatures, raw nonces, secrets, IPs, response bodies, user data or raw errors. Invalid signatures do not generate extra application audit writes/logs; hosting access logs cover those requests. Log retention and restricted access depend on the deployment platform; these records are not an immutable audit ledger or proof of the human actor. There is no unauthenticated log-storage endpoint.

## Files and verification

- `app/api/admin/v1/[resource]/route.ts`: thin read dispatch and explicit method denial.
- `lib/admin/config.ts`, `signature.ts`, `authenticate.ts`: independent configuration, v2 checks, shared rate limits and nonce protection.
- `lib/admin/audit.ts`, `queries.ts`, `response.ts`: restricted audit metadata, projected DTOs and safe responses.
- `models/AdminNonce.ts`: hashed nonces and TTL index.
- Super Admin `lib/integrations/admin-signature.ts`: matching read-only signer, used by its existing connector.

```sh
npm test
npm run test:admin
npm run lint
npm run typecheck
npm run build
npm run test:admin -- --production
# Optional: verify the actual signer in the neighboring Super Admin checkout:
npm run test:admin -- --production --connector
```

The HTTP suite uses disposable MongoDB and isolated local Next servers, synthetic credentials/data and test-only Redis faults. It covers private-field exclusion, unauthorized/cookie/bearer access, tampered identities/URLs/methods/bodies, legacy rejection, concurrent/cross-resource/cross-key/restart replay, credential expiry/removal, shared throttling, safe audit output and Redis/Mongo outage/recovery. It sends no email, modifies no real media and does not connect to production databases. Test ports are temporary; normal development stays on port 3000. Stop the dev server during a `.next` production build, then restart it.

Live Google login, HTTPS enrollment and production provisioning remain separate checks. Release-note drafts stay in ignored `.release-notes`. Do not push, tag, deploy or publish without a later instruction.
