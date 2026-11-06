import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { redisClient } from "../lib/redis/client.ts";
import { redisRateLimit } from "../lib/security/redis-rate-limit.ts";
import {
  readPublicData,
  withPublicDataMutation,
  publicCacheKeys,
  END_PUBLIC_MUTATION_SCRIPT,
} from "../lib/cache/public-data.ts";
import { withTemporaryLease } from "../lib/redis/lease.ts";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
process.env.REELOGRAM_REDIS_NAMESPACE = `test-${randomUUID()}`;
process.env.REELOGRAM_REDIS_DISABLED = "0";
const client = redisClient();
assert.ok(client, "Configure the Redis REST URL and write token");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
let checks = 0;
try {
  assert.equal(await client.command(["PING"]), "PONG");
  checks++;
  const buckets = [
    { id: "account", maximum: 3 },
    { id: "network", maximum: 100 },
  ];
  const attempts = await Promise.all(
    Array.from({ length: 12 }, () => redisRateLimit(client, buckets, 600)),
  );
  assert.equal(attempts.filter((value) => value === 0).length, 3);
  assert.equal(
    await client.command(["HGET", client.key("rate:network"), "count"]),
    "3",
  );
  const ttl = await client.command(["TTL", client.key("rate:account")]);
  assert.ok(ttl > 0 && ttl <= 1200);
  checks += 3;
  console.log(
    "Shared atomic counters, account-first throttling and rate TTLs passed.",
  );

  let loads = 0,
    value = "before";
  const load = async () => {
    loads++;
    return { value };
  };
  await readPublicData("feed:test", load, client);
  assert.deepEqual(await readPublicData("feed:test", load, client), {
    value: "before",
  });
  assert.equal(loads, 1);
  const cacheTtl = await client.command([
    "TTL",
    publicCacheKeys(client, "feed:test")[2],
  ]);
  assert.ok(cacheTtl > 0 && cacheTtl <= 15);
  await withPublicDataMutation(async () => {
    value = "after";
  }, client);
  assert.deepEqual(await readPublicData("feed:test", load, client), {
    value: "after",
  });
  assert.equal(loads, 2);
  checks += 5;

  const started = deferred(),
    release = deferred();
  const oldLoader = readPublicData(
    "race",
    async () => {
      started.resolve();
      await release.promise;
      return { value: "old" };
    },
    client,
  );
  await started.promise;
  await withPublicDataMutation(async () => {}, client);
  assert.deepEqual(
    await readPublicData("race", async () => ({ value: "new" }), client),
    { value: "new" },
  );
  release.resolve();
  await oldLoader;
  assert.deepEqual(
    await readPublicData(
      "race",
      async () => {
        throw Error("Fresh cache should remain");
      },
      client,
    ),
    { value: "new" },
  );
  checks += 2;

  const aStarted = deferred(),
    bStarted = deferred(),
    aRelease = deferred(),
    bRelease = deferred();
  const writerA = withPublicDataMutation(async () => {
    aStarted.resolve();
    await aRelease.promise;
  }, client);
  await aStarted.promise;
  const writerB = withPublicDataMutation(async () => {
    bStarted.resolve();
    await bRelease.promise;
  }, client);
  await bStarted.promise;
  aRelease.resolve();
  await writerA;
  let duringWrites = 0;
  await readPublicData("writers", async () => ++duringWrites, client);
  await readPublicData("writers", async () => ++duringWrites, client);
  assert.equal(duringWrites, 2);
  bRelease.resolve();
  await writerB;
  checks++;
  console.log(
    "Cache hits, short TTLs, concurrent mutation fencing and stale-loader rejection passed.",
  );

  const unavailable = {
    eval: async () => {
      throw Error("Unavailable");
    },
    key: (purpose) => client.key(purpose),
  };
  assert.equal(
    await readPublicData("outage", async () => "database", unavailable),
    "database",
  );
  let wrote = false;
  await assert.rejects(
    withPublicDataMutation(async () => {
      wrote = true;
    }, unavailable),
  );
  assert.equal(wrote, false);
  checks += 3;
  const failingFinish = {
    key: (purpose) => client.key(purpose),
    eval: (script, keys, args) =>
      script === END_PUBLIC_MUTATION_SCRIPT
        ? Promise.reject(Error("Unavailable"))
        : client.eval(script, keys, args),
  };
  await withPublicDataMutation(async () => {}, failingFinish);
  let bypasses = 0;
  await readPublicData("finish-failure", async () => ++bypasses, client);
  await readPublicData("finish-failure", async () => ++bypasses, client);
  assert.equal(bypasses, 2);
  const writerKey = publicCacheKeys(client, "x")[1];
  assert.ok((await client.command(["PTTL", writerKey])) > 0);
  const tokens = await client.command(["ZRANGE", writerKey, 0, -1]);
  for (const token of tokens)
    await client.command(["ZADD", writerKey, 0, token]);
  await readPublicData("recovered", async () => "fresh", client);
  assert.equal(
    await readPublicData("recovered", async () => "wrong", client),
    "fresh",
  );
  checks += 3;
  const keys = publicCacheKeys(client, "malformed");
  const generation = await client.command(["GET", keys[0]]);
  await client.command(["SET", keys[2], generation + "\nnot-json", "EX", 15]);
  assert.equal(
    await readPublicData("malformed", async () => "fixed", client),
    "fixed",
  );
  checks++;
  let bigLoads = 0;
  const big = async () => {
    bigLoads++;
    return "x".repeat(66000);
  };
  await readPublicData("large", big, client);
  await readPublicData("large", big, client);
  assert.equal(bigLoads, 2);
  checks++;
  console.log(
    "Outage behavior, failed-invalidation bypass, expired-writer recovery and payload bounds passed.",
  );

  const workStarted = deferred(),
    workRelease = deferred();
  let runs = 0;
  const work = withTemporaryLease(
    "prepare-test",
    async () => {
      runs++;
      workStarted.resolve();
      await workRelease.promise;
    },
    { leaseMs: 10000, completedMs: 1000 },
    client,
  );
  await workStarted.promise;
  assert.equal(
    await withTemporaryLease(
      "prepare-test",
      async () => {
        runs++;
      },
      { leaseMs: 10000, completedMs: 1000 },
      client,
    ),
    false,
  );
  workRelease.resolve();
  await work;
  assert.equal(
    await withTemporaryLease(
      "prepare-test",
      async () => {
        runs++;
      },
      { leaseMs: 10000, completedMs: 1000 },
      client,
    ),
    false,
  );
  assert.equal(runs, 1);
  checks += 3;
  await assert.rejects(
    withTemporaryLease(
      "retry-test",
      async () => {
        throw Error("Failed");
      },
      { leaseMs: 10000, completedMs: 0 },
      client,
    ),
  );
  assert.equal(
    await withTemporaryLease(
      "retry-test",
      async () => {},
      { leaseMs: 10000, completedMs: 0 },
      client,
    ),
    true,
  );
  checks += 2;
  const staleStarted = deferred(),
    staleRelease = deferred();
  const stale = withTemporaryLease(
    "stale-worker",
    async () => {
      staleStarted.resolve();
      await staleRelease.promise;
    },
    { leaseMs: 10000, completedMs: 1000 },
    client,
  );
  await staleStarted.promise;
  const leaseKey = client.key(
    `work:${createHash("sha256").update("stale-worker").digest("hex")}`,
  );
  await client.command(["SET", leaseKey, "successor", "PX", 10000]);
  staleRelease.resolve();
  await stale;
  assert.equal(await client.command(["GET", leaseKey]), "successor");
  checks++;
  console.log(
    "Background deduplication, failed-work retries and ownership-safe lease release passed.",
  );
  console.log(`PASS: ${checks} live Redis checks.`);
} finally {
  // Only this random test namespace; never FLUSHDB or delete production keys.
  let cursor = "0";
  const keys = [];
  do {
    const result = await client.command([
      "SCAN",
      cursor,
      "MATCH",
      client.prefix + ":*",
      "COUNT",
      100,
    ]);
    cursor = String(result[0]);
    keys.push(...result[1]);
  } while (cursor !== "0");
  if (keys.length) await client.command(["DEL", ...keys]);
  console.log("Removed isolated Redis test keys.");
}
