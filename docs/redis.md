# Redis responsibilities and safeguards

The app uses Upstash's HTTPS REST API through server-side modules. It uses the existing `REELOGRAM_KV_REST_API_URL` and **write** `REELOGRAM_KV_REST_API_TOKEN`; the read-only token and TCP URLs are not needed. No Redis credentials are included in client bundles. Vercel's Upstash integration supplies these variables to Production.

## Organization

- `lib/redis/client.ts`: validated HTTPS transport, two-second timeouts, sanitized errors and environment-specific keys.
- `lib/security/redis-rate-limit.ts`: atomic Lua rate counters using Redis's clock.
- `lib/security/rate-limit.ts`: the existing account/network policy interface; chooses Redis when configured.
- `lib/cache/public-data.ts`: short public-response caching, generation checks and concurrent-write guards.
- `lib/cache/feed.ts`: the bounded allowlist of cacheable feed requests.
- `lib/redis/lease.ts`: owner-checked leases for bounded, repeatable background work.
- `lib/video-preparation.ts`: uses temporary leases to avoid duplicate ImageKit preparation.

## Lifetimes and isolation

Public feed and showcase payloads expire after **15 seconds**. Only validated public first pages with five items, finite sort/date/source filters and no search or cursor are cached. Private feeds, account details, authentication, individual video pages and errors are not cached. Entries are limited to 64 KiB. HTTP responses remain `no-store`; Redis is the only response cache added here.

A public write changes the cache generation before changing MongoDB, registers a unique **120-second** writer lease, and changes the generation again on completion. Readers bypass the cache while any writer is active. A loader from an older generation cannot overwrite a newer cache value. Independent writer tokens prevent one completed request from releasing another writer's guard. Public DB writes use a 10-second server operation limit, comfortably below the lease. If the final Redis acknowledgement fails, the guard continues to bypass cached data until it expires; it does not resurrect the old generation.

Publishing, editing, hiding/deleting videos, replacing/removing profile photos and filling missing profile details invalidate public responses. Existing GET URLs and database ownership checks are unchanged. Direct administrative MongoDB edits outside these helpers become visible within the 15-second data TTL; run `npm run cache:invalidate` with the intended environment/namespace if immediate invalidation is needed after maintenance.

Rate counters expire within at most two policy windows (no more than two hours with current policies). Redis uses HMAC identifiers; raw emails, IP addresses and account IDs are not rate keys. The account bucket is checked before the shared network bucket, and rejected account attempts do not consume the network quota. A single Lua operation performs the checks and increments across instances. Counters never grow indefinitely.

Video preparation uses a **60-second** lease and a **five-minute** completed-work marker. The work itself uses bounded five-second range probes and never downloads whole videos. Only the lease owner may release/complete it. An expired worker cannot release its successor's lease. Failed work is retryable; a crashed worker's lease expires. This is bounded best-effort deduplication, not a durable exactly-once job queue. Existing MongoDB email outbox deduplication, provider receipts, quotas, media deletion locks and avatar cleanup records remain authoritative.

Production, preview branches and local development have distinct key prefixes, also scoped to the configured app origin. `REELOGRAM_REDIS_NAMESPACE` optionally overrides the namespace (letters, digits, colons, underscores and hyphens, up to 100 characters); do not point local/test instances at a production namespace. Every application Redis key has a TTL. No `FLUSHDB`, wildcard deletion or persistent cache entries are used by the app.

## Failure policy

When Redis is not configured, existing MongoDB rate limits remain active and caching/temporary deduplication are disabled. `REELOGRAM_REDIS_DISABLED=1` explicitly selects that mode, primarily for isolated regression tests. Do not toggle it during an attack: changing stores starts a different counter set.

When Redis **is configured but unavailable**, rate-limited endpoints return a controlled error rather than bypass protection or switch to fresh MongoDB counters. A cache-read failure alone falls back to fresh MongoDB data. If a public write cannot establish its cache guard, it stops before modifying the record. Optional video preparation is skipped on Redis failure so publishing notifications are not interrupted. REST requests do not follow redirects, log credentials or blindly retry potentially applied mutations.

## Validation

`npm test` checks configuration isolation, unsafe endpoints, redacted errors and cache exclusions. `npm run test:redis` exercises actual Upstash atomic counters, TTLs, stale loaders, overlapping writers, failed invalidation, malformed/oversized cache entries and owner-safe work leases. `npm run test:redis-routes` boots an isolated MongoDB and Next.js server to verify API cache hits, private-feed isolation, edit/profile invalidation, deletion visibility and rate limiting. Both Redis suites use random test namespaces and delete only their own keys. They never flush the database or modify production accounts/media.
