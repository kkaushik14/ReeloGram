import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHmac, randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { writeFile, rm } from "node:fs/promises";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { encode } from "next-auth/jwt";
import { redisClient } from "../lib/redis/client.ts";
import {
  withPublicDataMutation,
  publicCacheKeys,
} from "../lib/cache/public-data.ts";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
process.env.REELOGRAM_REDIS_NAMESPACE = `route-test-${randomUUID()}`;
process.env.REELOGRAM_REDIS_DISABLED = "0";
const client = redisClient();
assert.ok(client);
const secret = randomBytes(32).toString("hex");
const faults = process.argv.includes("--faults");
const faultFile = join(tmpdir(), `reelogram-redis-fault-${randomUUID()}`);
let database, server, exited;
let checks = 0;
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const base = `http://127.0.0.1:${port}`;
let cookie;
const request = async (
  path,
  { body, authenticated = false, status = 200, method, headers = {} } = {},
) => {
  const response = await fetch(base + path, {
    method: method || (body ? "PATCH" : "GET"),
    headers: {
      ...(authenticated ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json", Origin: base } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, status, path);
  checks++;
  return response;
};
try {
  if (faults) await writeFile(faultFile, "healthy");
  database = await MongoMemoryServer.create({
    instance: { dbName: "redis_routes" },
    binary: { downloadDir: join(tmpdir(), "reelogram-mongodb-binaries") },
  });
  await mongoose.connect(database.getUri());
  const db = mongoose.connection.db;
  const owner = new mongoose.Types.ObjectId(),
    id = new mongoose.Types.ObjectId(),
    hero = new mongoose.Types.ObjectId();
  await db.collection("users").insertOne({
    _id: owner,
    email: "redis-routes@example.invalid",
    password: "not-used",
    dateOfBirth: new Date("1990-01-01"),
    emailVerifiedAt: new Date(),
    sessionVersion: 0,
  });
  const document = {
    description: "Synthetic Redis check",
    videoUrl: "https://ik.imagekit.io/test/legacy.mp4",
    thumbNailUrl: "https://ik.imagekit.io/test/legacy.jpg",
    controls: true,
    uploadedBy: owner,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection("videos").insertMany([
    { ...document, _id: id, title: "Before edit", placement: "feed" },
    { ...document, _id: hero, title: "Showcase before", placement: "hero" },
  ]);
  cookie =
    "next-auth.session-token=" +
    (await encode({
      token: {
        id: String(owner),
        sessionVersion: 0,
        email: "redis-routes@example.invalid",
      },
      secret,
    }));
  await writeFile(
    ".e2e.tsconfig.json",
    JSON.stringify({ extends: "./tsconfig.json" }),
  );
  server = spawn(
    process.execPath,
    [
      ...(faults ? ["--import", "./scripts/testing/redis-faults.mjs"] : []),
      require.resolve("next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: {
        ...process.env,
        PATH: dirname(process.execPath) + ":" + process.env.PATH,
        REELOGRAM_MONGODB_URL: database.getUri(),
        REELOGRAM_APP_URL: base,
        REELOGRAM_NEXTAUTH_URL: base,
        REELOGRAM_NEXTAUTH_SECRET: secret,
        REELOGRAM_AUTH_TRUST_PROXY: "0",
        REELOGRAM_E2E_DIST_DIR: ".next-redis",
        ...(faults ? { REELOGRAM_TEST_REDIS_FAULT_FILE: faultFile } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  exited = once(server, "exit");
  let logs = "";
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      logs = (logs + chunk).slice(-12000);
    });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(base + "/api/showcase", {
        signal: AbortSignal.timeout(1000),
      });
      if (r.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, "Isolated Redis test server must start");
  // Profile only this disposable database, never the production Atlas cluster.
  const publicReads = () =>
    db.collection("system.profile").countDocuments({
      $or: [
        { "command.find": { $in: ["videos", "users"] } },
        { "command.aggregate": "videos" },
      ],
    });
  await db.command({ profile: 2 });
  const first = await (await request("/api/videos?limit=5")).json();
  await db.command({ profile: 0 });
  const missReads = await publicReads();
  assert.equal(
    missReads,
    3,
    "Feed miss reads videos, count and public uploader",
  );
  assert.equal(first.videos[0].title, "Before edit");
  await db
    .collection("videos")
    .updateOne({ _id: id }, { $set: { title: "Direct database edit" } });
  await db.command({ profile: 2 });
  const hit = await (await request("/api/videos?limit=5")).json();
  await db.command({ profile: 0 });
  assert.equal(
    await publicReads(),
    missReads,
    "Feed hit executes zero MongoDB reads",
  );
  await client.command(["DEL", publicCacheKeys(client, "showcase")[2]]);
  const beforeShowcase = await publicReads();
  await db.command({ profile: 2 });
  await request("/api/showcase");
  await db.command({ profile: 0 });
  assert.equal(
    await publicReads(),
    beforeShowcase + 1,
    "Showcase miss executes one MongoDB read",
  );
  await db.command({ profile: 2 });
  await request("/api/showcase");
  await db.command({ profile: 0 });
  assert.equal(
    await publicReads(),
    beforeShowcase + 1,
    "Showcase hit executes zero MongoDB reads",
  );
  console.log(
    "MongoDB profiler: feed 3 → 0 reads; showcase 1 → 0 reads on Redis hits.",
  );
  assert.equal(
    hit.videos[0].title,
    "Before edit",
    "Public request should hit Redis",
  );
  const mine = await (
    await request("/api/videos?mine=true&limit=5", { authenticated: true })
  ).json();
  assert.equal(
    mine.videos[0].title,
    "Direct database edit",
    "Private feed bypasses Redis",
  );
  await request("/api/videos/" + id, {
    authenticated: true,
    body: { title: "Published edit" },
  });
  const edited = await (await request("/api/videos?limit=5")).json();
  assert.equal(edited.videos[0].title, "Published edit");
  await request("/api/account", {
    authenticated: true,
    body: { name: "Redis Creator" },
  });
  const renamed = await (await request("/api/videos?limit=5")).json();
  assert.equal(renamed.videos[0].uploader.name, "Redis Creator");
  assert.equal(
    (await (await request("/api/showcase")).json()).videos[0].title,
    "Showcase before",
  );
  await withPublicDataMutation(
    async () =>
      db
        .collection("videos")
        .updateOne(
          { _id: hero },
          { $set: { title: "Showcase after" } },
          { maxTimeMS: 10000 },
        ),
    client,
  );
  assert.equal(
    (await (await request("/api/showcase")).json()).videos[0].title,
    "Showcase after",
  );
  await withPublicDataMutation(
    async () =>
      db
        .collection("videos")
        .updateOne(
          { _id: id },
          { $set: { deletionPending: true } },
          { maxTimeMS: 10000 },
        ),
    client,
  );
  assert.equal(
    (await (await request("/api/videos?limit=5")).json()).videos.length,
    0,
    "Pending deletions leave the public feed immediately",
  );
  await request("/api/account", { status: 401 });
  await request("/api/account", { authenticated: true });
  if (faults) {
    // No real provider outage, production data, emails or ImageKit uploads.
    const csrfResponse = await request("/api/auth/csrf");
    const csrf = await csrfResponse.json();
    const csrfCookies = csrfResponse.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const rejectLogin = async () => {
      const r = await fetch(base + "/api/auth/callback/credentials", {
        method: "POST",
        headers: {
          Cookie: csrfCookies,
          Origin: base,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          csrfToken: csrf.csrfToken,
          email: "redis-routes@example.invalid",
          password: "Temporary-Test-Password-82!",
          json: "true",
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
      // NextAuth uses 401 for authorize failures and puts the safe message in its JSON URL.
      assert.equal(r.status, 401);
      const result = await r.json();
      assert.match(
        new URL(result.url).searchParams.get("error"),
        /Sign-in is temporarily unavailable/,
      );
      assert.ok(
        !r.headers.getSetCookie().some((value) => /session-token=/.test(value)),
        "No new authenticated session during outage",
      );
      checks++;
    };
    const unavailable = async (path, options = {}) => {
      const r = await request(path, { ...options, status: 503 });
      assert.equal(r.headers.get("Cache-Control"), "no-store");
      assert.equal(r.headers.get("Retry-After"), "30");
      const data = await r.json();
      assert.equal(data.code, "SERVICE_UNAVAILABLE");
      assert.match(data.error, /temporarily unavailable/);
      assert.ok(!JSON.stringify(data).match(/upstash|quota|token|credential/i));
    };
    // Compile each route before measuring the bounded Redis timeout.
    await request("/api/imagekit-auth", { status: 401 });
    await request("/api/videos", { method: "POST", body: {}, status: 401 });
    await request("/api/auth/identify", {
      method: "POST",
      body: { email: "invalid" },
      status: 400,
    });
    for (const mode of [
      "network",
      "timeout",
      "quota",
      "server",
      "command",
      "malformed",
    ]) {
      await writeFile(faultFile, mode);
      const start = performance.now();
      await unavailable("/api/videos?limit=5");
      assert.ok(
        performance.now() - start < 6000,
        "Redis failure must be bounded",
      );
      await unavailable("/api/showcase");
      await unavailable("/api/account", { authenticated: true });
      await unavailable("/api/imagekit-auth", { authenticated: true });
      await unavailable("/api/videos", {
        method: "POST",
        body: {},
        authenticated: true,
      });
      await unavailable("/api/videos/" + hero, {
        body: { title: "Must not change" },
        authenticated: true,
      });
      await unavailable("/api/videos/" + hero, {
        method: "DELETE",
        headers: { Origin: base },
        authenticated: true,
      });
      await unavailable("/api/account", {
        body: { name: "Must not change" },
        authenticated: true,
      });
      await unavailable("/api/auth/identify", {
        method: "POST",
        body: { email: "redis-routes@example.invalid" },
      });
      await unavailable("/api/auth/forgot-password", {
        method: "POST",
        body: { email: "redis-routes@example.invalid" },
      });
      await unavailable("/api/auth/register", {
        method: "POST",
        body: {
          email: "new-redis-user@example.invalid",
          name: "Redis Test",
          dateOfBirth: "1990-01-01",
          password: "Temporary-Test-Password-82!",
        },
      });
      await unavailable("/api/auth/reset-password", {
        method: "POST",
        body: {
          token: "a".repeat(43),
          password: "Temporary-Test-Password-82!",
        },
      });
      await rejectLogin();
      await request("/api/account", { status: 401 });
      assert.equal(
        (
          await (
            await request("/api/auth/session", { authenticated: true })
          ).json()
        ).user.id,
        String(owner),
        "Outage must not sign out existing users",
      );
      assert.equal(
        (await db.collection("videos").findOne({ _id: hero })).title,
        "Showcase after",
      );
      assert.equal(
        (await db.collection("users").findOne({ _id: owner })).name,
        "Redis Creator",
      );
      assert.equal(
        await db.collection("auth_rate_limits").countDocuments({}),
        0,
        "No fresh Mongo fallback counters",
      );
      assert.equal(
        await db.collection("users").countDocuments({}),
        1,
        "No account created during outage",
      );
      const unchangedUser = await db
        .collection("users")
        .findOne({ _id: owner });
      assert.equal(unchangedUser.password, "not-used");
      assert.ok(
        !unchangedUser.passwordReset,
        "No reset token issued during outage",
      );
      console.log(
        `PASS: ${mode} fails closed with safe messages; session and stored data preserved.`,
      );
    }
    await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        unavailable("/api/videos?limit=5", {
          headers: { "x-forwarded-for": `198.51.100.${n + 1}` },
        }),
      ),
    );
    // Cache failures may fall back to fresh DB reads ONLY after rate protection succeeded.
    await writeFile(faultFile, "cache-only");
    assert.equal(
      (await (await request("/api/showcase")).json()).videos[0].title,
      "Showcase after",
    );
    await unavailable("/api/videos/" + hero, {
      body: { title: "Unfenced change" },
      authenticated: true,
    });
    assert.equal(
      (await db.collection("videos").findOne({ _id: hero })).title,
      "Showcase after",
    );
    await writeFile(faultFile, "healthy");
    await request("/api/showcase");
    await request("/api/account", { authenticated: true });
  }
  assert.equal(
    await db.collection("auth_rate_limits").countDocuments({}),
    0,
    "Routes use Redis counters instead of Mongo counters",
  );
  let cursor = "0",
    keys = [];
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
  for (const key of keys) {
    assert.ok(
      (await client.command(["TTL", key])) >= 0,
      "Every live Redis key must expire",
    );
    if (key.includes(":public:page:")) {
      const value = await client.command(["GET", key]);
      assert.ok(
        !value.includes("redis-routes@example.invalid") &&
          !value.includes("dateOfBirth") &&
          !value.includes("password"),
      );
    }
  }
  const now = await client.command(["TIME"]);
  const rate = client.key(
    "rate:" +
      createHmac("sha256", secret).update("feed:network:shared").digest("hex"),
  );
  await client.command([
    "HSET",
    rate,
    "window",
    Math.floor(Number(now[0]) / 60),
    "count",
    180,
  ]);
  await client.command(["EXPIRE", rate, 120]);
  const blocked = await request("/api/videos?limit=5", { status: 429 });
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  if (faults) {
    await writeFile(faultFile, "quota");
    await request("/api/videos?limit=5", { status: 503 });
    await writeFile(faultFile, "healthy");
    await request("/api/videos?limit=5", {
      status: 429,
      headers: { "x-forwarded-for": "198.51.100.99" },
    });
    console.log(
      "PASS: recovery preserves an exhausted rate-limit bucket; forged forwarding headers cannot bypass it.",
    );
  }
  console.log(
    `PASS: ${checks} Redis-backed API requests plus cache-hit, private-data isolation, title/name invalidation, deletion visibility and TTL assertions.`,
  );
} catch (error) {
  console.error("Redis route check failed:", error.message);
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
  await mongoose.disconnect();
  if (database) await database.stop();
  await rm(".e2e.tsconfig.json", { force: true });
  await rm(faultFile, { force: true });
  let cursor = "0",
    keys = [];
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
  console.log("Removed isolated Redis route-test keys and database.");
}
