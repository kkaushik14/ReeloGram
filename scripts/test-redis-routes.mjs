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
  { body, authenticated = false, status = 200 } = {},
) => {
  const response = await fetch(base + path, {
    method: body ? "PATCH" : "GET",
    headers: {
      ...(authenticated ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json", Origin: base } : {}),
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
