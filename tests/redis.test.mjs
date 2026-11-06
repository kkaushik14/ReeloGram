import { test } from "node:test";
import assert from "node:assert/strict";
import { redisClient, RedisUnavailableError } from "../lib/redis/client.ts";
import { publicFeedCacheKey } from "../lib/cache/feed.ts";
import { redisRateLimit } from "../lib/security/redis-rate-limit.ts";
import { withPublicDataMutation } from "../lib/cache/public-data.ts";
import { parseFeedQuery } from "../lib/video-input.ts";

const configuration = {
  REELOGRAM_KV_REST_API_URL: "https://example.upstash.io",
  REELOGRAM_KV_REST_API_TOKEN: "write-secret",
  REELOGRAM_APP_URL: "https://example.com",
};
test("malformed Redis acknowledgements cannot bypass rate checks or permit an unfenced write", async () => {
  const invalid = { key: (name) => name, eval: async () => null };
  await assert.rejects(
    redisRateLimit(invalid, [{ id: "account", maximum: 3 }], 60),
    RedisUnavailableError,
  );
  let written = false;
  await assert.rejects(
    withPublicDataMutation(async () => {
      written = true;
    }, invalid),
    RedisUnavailableError,
  );
  assert.equal(written, false);
});
test("Redis credentials remain server-side and environment namespaces stay isolated", () => {
  assert.equal(redisClient({}), null);
  assert.equal(
    redisClient({ ...configuration, REELOGRAM_REDIS_DISABLED: "1" }),
    null,
  );
  assert.throws(
    () =>
      redisClient({
        REELOGRAM_KV_REST_API_URL: configuration.REELOGRAM_KV_REST_API_URL,
        REELOGRAM_KV_REST_API_READ_ONLY_TOKEN: "read",
      }),
    RedisUnavailableError,
  );
  for (const url of [
    "http://example.upstash.io",
    "https://evil.example",
    "https://example.upstash.io@evil.example",
    "https://example.upstash.io/path",
    "https://example.upstash.io/?token=secret",
  ])
    assert.throws(
      () => redisClient({ ...configuration, REELOGRAM_KV_REST_API_URL: url }),
      RedisUnavailableError,
    );
  const prod = redisClient({ ...configuration, VERCEL_ENV: "production" });
  const local = redisClient(configuration);
  const preview = redisClient({
    ...configuration,
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature",
  });
  assert.equal(new Set([prod.prefix, local.prefix, preview.prefix]).size, 3);
  assert.ok(!prod.prefix.includes("example.com"));
});
test("Redis requests use bounded HTTPS POSTs, no redirects or automatic mutation retries, and redact service errors", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(url, configuration.REELOGRAM_KV_REST_API_URL);
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.method, "POST");
    assert.ok(options.signal);
    return Response.json({ error: "secret diagnostic write-secret" });
  });
  await assert.rejects(
    redisClient(configuration).command(["PING"]),
    (error) =>
      error instanceof RedisUnavailableError &&
      !error.message.includes("write-secret"),
  );
  assert.equal(calls, 1);
});
test("public feed caching excludes private feeds, arbitrary searches and cursor pages", () => {
  const query = (search) => parseFeedQuery(new URLSearchParams(search));
  assert.ok(publicFeedCacheKey(query("limit=5")));
  assert.equal(publicFeedCacheKey(query("limit=5&mine=true")), null);
  assert.equal(publicFeedCacheKey(query("limit=5&q=something")), null);
  assert.equal(publicFeedCacheKey(query("limit=1")), null);
  assert.equal(
    publicFeedCacheKey({
      ...query("limit=5"),
      cursor: { id: "123", createdAt: new Date() },
    }),
    null,
  );
  assert.notEqual(
    publicFeedCacheKey(query("limit=5&sort=newest")),
    publicFeedCacheKey(query("limit=5&sort=oldest")),
  );
});
