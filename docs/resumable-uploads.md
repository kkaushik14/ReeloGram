# Resumable uploads

One private Cloudflare R2 bucket stages the original video and cover. QStash invokes short, signed Next.js endpoints; there is no separate worker service, compression, second ImageKit account, or video data in Redis. Production activation is gated by `REELOGRAM_RESUMABLE_UPLOADS=1` and requires the configuration below. Existing direct uploads remain available while it is disabled.

## Configuration

Add the variables listed under resumable staging in `env.sample` to the deployment, including the regional QStash URL shown in its console. Credentials remain server-only. Use an R2 token restricted to object read/write in this staging bucket. Disable the bucket's public development URL and public custom domains. Do not reuse a public delivery bucket.

Set bucket CORS with **exact origins** for the deployed app and `http://localhost:3000`, methods `PUT`, allowed headers `Content-Type`, and expose `ETag`. Never allow a wildcard origin. The browser uploads only signed parts; listing, completion and deletion are server-side. Signed part URLs expire after ten minutes and bind the object, multipart ID, part number and content length. Retry obtains a fresh URL. An already issued URL is a bearer grant until expiry; cancelling aborts its multipart upload.

Example (replace the production placeholder with the actual configured app origin):

```json
[
  {
    "AllowedOrigins": ["https://YOUR-APP-ORIGIN", "http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 600
  }
]
```

Add bucket lifecycle rules scoped to `drafts/`: abort incomplete multipart uploads after **one day**, and expire completed objects after **three days**. These are a backstop for a crash before a database write or extended scheduler outage. The application normally deletes drafts after cancellation, after confirmed publication, or after the 24-hour draft/job deadline. Do not apply staging lifecycle rules to permanent media buckets.

Create a QStash schedule: `POST {REELOGRAM_APP_URL}/api/uploads/maintenance`, cron `*/5 * * * *`, **empty request body**. QStash signs deliveries automatically. This recovers database-backed publish intents when initial enqueueing fails and cleans expired drafts. The daily Vercel cron is a backup, not the normal retry cadence. Retain `CRON_SECRET` for that daily endpoint. Configure the production URL before creating the schedule; it must match the destination checked by signature verification, including path. No redirects.

Use `node --experimental-strip-types scripts/uploads/configure-schedule.mjs --origin https://YOUR-APP-ORIGIN` to review the schedule. Add `--apply --paused` to prepare it before deployment, then run with `--apply` after the signed endpoint is live. The fixed schedule ID updates the existing schedule instead of creating duplicates. Its separate concurrency limit permits only one maintenance delivery at a time. This schedule runs independently of deployments; verify successful scheduled deliveries in QStash after rollout. It makes 288 scheduled requests per day, excluding retries and upload processing, so include those in the account's quota monitoring.

Hosted QStash cannot call localhost. Local HTTP integration tests use a disposable database and a test-only provider adapter. For live local delivery use an explicitly configured HTTPS tunnel in `REELOGRAM_UPLOAD_CALLBACK_ORIGIN`; this changes only the signed callback destination and keeps sign-in and the app on localhost:3000. Leave that override empty in production. Alternatively test a deployed preview with its own credentials and schedule. Never use visitor-controlled headers to choose the callback URL.

## Flow and guarantees

1. Selecting a validated file creates an owned database asset and R2 multipart upload. Six outstanding assets and 310 MiB staged bytes per account bound storage, in addition to fail-closed shared rate limiting.
2. The page uploads 8 MiB parts, at most two simultaneously per file. The video and cover can upload together. Failed parts retry up to three attempts with backoff. Manual retry queries saved parts and only sends missing ones. Refresh during an unfinished transfer requires file reselection; already completed staging IDs and form text survive same-tab refresh for up to 24 hours. Files, credentials and signed URLs are never serialized to browser storage.
3. Completion independently lists stored parts, verifies exact part lengths/count/order, checks the completed object size and its leading bytes. This is an initial file screen, not a malware scanner or full codec validator. ImageKit's detected media type is checked again before publishing.
4. Publish transactionally claims both ready assets and records immutable title/description with the owner's current session version. It returns 202 only after durable database intent exists. Duplicate submissions for the same video return the existing job; conflicting details are rejected. No public feed record exists yet.
5. QStash delivers a job ID; body, signature, expiration and exact destination are verified. Database leases and state checks make duplicates harmless. Each invocation transfers at most one asset from a short-lived R2 GET URL to the existing ImageKit account, or performs final publication. No large file crosses Vercel's request body.
6. Provider response loss is reconciled using the exact server-generated ImageKit file path. No overwrite or random duplicate filename. Publication uses the existing media ownership checks, cache invalidation, account suspension fence and email outbox. The job state and new video are committed in the same transaction.
7. Temporary failures have bounded retries and a next-attempt time. Permanent validation failures stop. No invented completion ETA. In Your videos, owners see pending and failed jobs in Upload activity; completed jobs refresh the normal video grid and disappear from the activity section. Job status remains available to its owner for seven days. Others cannot query these jobs.
8. Cleanup only purges failed-job ImageKit files after checking that no video references them. R2 staging copies are removed after successful publication; cleanup retries retain metadata. No public media is removed by R2 lifecycle rules.

Queue messages may be delivered more than once. MongoDB is authoritative; Redis is not the durable upload/job store. An app instance or browser can disappear after successful staging/publish submission without losing the job. Before staging completes, the browser must remain open. ImageKit's plan/file/format limits still apply; chunking is not a bypass and no compression is performed.

## Verification and rollout

Run `npm test`, `npm run test:uploads`, `npm run test:e2e`, lint, typecheck and a production build. `test:uploads` replaces provider requests only in its isolated subprocess; production code has no test mode that disables signature or ownership checks.

`scripts/test-upload-providers.mjs --live` is an opt-in R2/CORS/ImageKit smoke test. Load the project's environment files before running; set `UPLOAD_TEST_ORIGINS` to the comma-separated production origins to check. It creates and removes only uniquely named test objects. `scripts/test-live-upload.mjs --live` additionally uses a disposable MongoDB and real QStash callbacks through an official `cloudflared` binary supplied in `UPLOAD_TEST_TUNNEL_BINARY`. Supply a synthetic MP4 at `UPLOAD_TEST_VIDEO`; the script adds an MP4 free box to exercise a 98 MiB upload, checks idempotent publication and delivery, and cleans test media afterward. Only authenticated callback routes are exposed by its temporary proxy; production account/feed data is never touched. `--hold` keeps the isolated server on localhost:3000 for browser checks until SIGINT.

Then validate real R2 signed PUT requests/CORS on Android Brave with Shields enabled, Chrome and iPhone Safari; test a near-limit MP4, interrupted/retried parts, cancellation, refresh after staging, navigation after Publish, queue retries and ImageKit playback. Check bucket lifecycle and the five-minute schedule before enabling the flag. A successful mock test does not establish real-browser or real-provider compatibility.

Rollback: disable `REELOGRAM_RESUMABLE_UPLOADS` and redeploy to restore the existing upload form. Keep the queue credentials and processing endpoint available until queued jobs drain; keep the R2 lifecycle and cleanup schedule until staging is empty. Never remove the database metadata first.
