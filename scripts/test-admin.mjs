import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { writeFile, rm } from "node:fs/promises";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { encode } from "next-auth/jwt";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
const secret = randomBytes(32).toString("hex");
const authSecret = randomBytes(32).toString("hex");
const projectId = "reelogram-test";
const keyId = "key-current";
const previousSecret = randomBytes(32).toString("hex");
const previousKeyId = "key-previous";
const faultFile = join(tmpdir(), `reelogram-admin-fault-${randomUUID()}`);
let database,
  server,
  exited,
  base,
  logs = "",
  checks = 0;
const production = process.argv.includes("--production");

async function stop() {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
}
async function start(overrides = {}, fault = false) {
  await stop();
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  base = `http://127.0.0.1:${port}`;
  logs = "";
  server = spawn(
    process.execPath,
    [
      ...(fault ? ["--import", "./scripts/testing/redis-faults.mjs"] : []),
      require.resolve("next/dist/bin/next"),
      production ? "start" : "dev",
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
        REELOGRAM_NEXTAUTH_SECRET: authSecret,
        REELOGRAM_AUTH_TRUST_PROXY: "0",
        VERCEL: "",
        VERCEL_ENV: "",
        REELOGRAM_REDIS_DISABLED: "1",
        REELOGRAM_ADMIN_ENABLED: "1",
        REELOGRAM_ADMIN_ACTIONS_ENABLED: "0",
        REELOGRAM_ADMIN_PROJECT_ID: projectId,
        REELOGRAM_ADMIN_SECRET: secret,
        REELOGRAM_ADMIN_KEY_ID: keyId,
        REELOGRAM_ADMIN_ENVIRONMENT: "local",
        REELOGRAM_ADMIN_AUDIENCE: base,
        REELOGRAM_ADMIN_PREVIOUS_KEY_ID: "",
        REELOGRAM_ADMIN_PREVIOUS_SECRET: "",
        REELOGRAM_ADMIN_PREVIOUS_VALID_UNTIL: "",
        REELOGRAM_TEST_REDIS_FAULT_FILE: faultFile,
        REELOGRAM_E2E_DIST_DIR: production ? "" : ".next-admin",
        ...overrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  exited = once(server, "exit");
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      logs = (logs + chunk).slice(-6000);
    });
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(base + "/api/auth/session", {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw Error("Isolated admin test server did not start");
}

function headers(path, options = {}) {
  const time = options.time || String(Math.floor(Date.now() / 1000));
  const nonce = options.nonce || randomUUID();
  const identity = {
    projectId,
    environment: "local",
    audience: base,
    keyId: options.keyId || keyId,
    ...options.identity,
  };
  const payload = JSON.stringify([
    "reelogram-admin",
    "2",
    "read",
    identity.projectId,
    identity.environment,
    identity.audience,
    identity.keyId,
    "GET",
    path,
    time,
    nonce,
    createHash("sha256").update("").digest("hex"),
  ]);
  return {
    "X-Admin-Version": "2",
    "X-Admin-Scope": "read",
    "X-Admin-Project": identity.projectId,
    "X-Admin-Environment": identity.environment,
    "X-Admin-Audience": identity.audience,
    "X-Admin-Key-Id": identity.keyId,
    "X-Admin-Time": time,
    "X-Admin-Nonce": nonce,
    "X-Admin-Signature": createHmac("sha256", options.secret || secret)
      .update(payload)
      .digest("hex"),
    ...options.headers,
  };
}
async function request(
  resource,
  { status = 200, unsigned = false, method = "GET", ...options } = {},
) {
  const path = "/api/admin/v1/" + resource;
  const r = await fetch(base + path, {
    method,
    headers: unsigned ? options.headers : headers(path, options),
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(r.status, status, `${method} ${path}`);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(r.headers.get("x-robots-tag"), /noindex/);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  if (status === 404) {
    assert.equal(r.headers.get("allow"), null);
    if (method !== "HEAD")
      assert.deepEqual(await r.clone().json(), { error: "Not found" });
  }
  checks++;
  return r;
}

try {
  await writeFile(
    ".e2e.tsconfig.json",
    JSON.stringify({ extends: "./tsconfig.json" }),
  );
  await writeFile(faultFile, "network");
  database = await MongoMemoryServer.create({
    instance: { dbName: "admin_test" },
    binary: { downloadDir: join(tmpdir(), "reelogram-mongodb-binaries") },
  });
  await mongoose.connect(database.getUri());
  const db = mongoose.connection.db;
  const users = Array.from({ length: 105 }, (_, i) => ({
    _id: new mongoose.Types.ObjectId(),
    name: i === 104 ? "<script>Safe text</script>" : `Reader ${i}`,
    email: "private@example.invalid",
    password: "NEVER_RETURN_PASSWORD",
    dateOfBirth: new Date(i === 103 ? "2018-01-01" : "1990-01-01"),
    ...(i === 102 ? {} : { emailVerifiedAt: new Date() }),
    parent: {
      email: "PRIVATE_PARENT@example.invalid",
      confirmation: { digest: "PRIVATE_CONFIRMATION" },
    },
    passwordReset: {
      digest: "PRIVATE_RESET",
      expiresAt: new Date(Date.now() + 60000),
    },
  }));
  const videos = Array.from({ length: 105 }, (_, i) => ({
    _id: new mongoose.Types.ObjectId(),
    title: `Video ${i}`,
    placement: i === 103 ? "hero" : i === 102 ? "archived" : "feed",
    deletionPending: i === 104,
    videoUrl: "https://example.invalid/PRIVATE_MEDIA",
    fileId: "PRIVATE_FILE",
    uploadedBy: users[0]._id,
  }));
  const jobs = ["pending", "sending", "failed", "sent", "pending"].map(
    (status, i) => ({
      _id: createHash("sha256").update(String(i)).digest("hex"),
      status,
      attempts: i,
      to: "PRIVATE_RECIPIENT@example.invalid",
      html: "PRIVATE_EMAIL_BODY",
      subject: "PRIVATE_SUBJECT",
      expiresAt: new Date(Date.now() + (i === 4 ? -60000 : 60000)),
    }),
  );
  await db.collection("users").insertMany(users);
  await db.collection("videos").insertMany(videos);
  await db.collection("emailjobs").insertMany(jobs);
  const snapshot = async () =>
    JSON.stringify(
      await Promise.all(
        ["users", "videos", "emailjobs"].map((name) =>
          db.collection(name).find({}).sort({ _id: 1 }).toArray(),
        ),
      ),
    );
  const before = await snapshot();
  await start();
  const manifest = await (await request("manifest")).json();
  assert.deepEqual(manifest, {
    projectId,
    version: "1",
    capabilities: ["accounts.read", "videos.read", "jobs.read"],
  });
  const accounts = await (await request("accounts")).json();
  const videoList = await (await request("videos")).json();
  const jobList = await (await request("jobs")).json();
  for (const data of [accounts, videoList]) {
    assert.equal(data.items.length, 100);
    assert.equal(data.truncated, true);
  }
  assert.equal(jobList.items.length, 3);
  for (const data of [accounts, videoList, jobList]) {
    assert.ok(Buffer.byteLength(JSON.stringify(data)) < 256 * 1024);
    for (const item of data.items)
      assert.deepEqual(Object.keys(item).sort(), [
        "detail",
        "id",
        "label",
        ...(data === jobList ? [] : ["revision"]),
        "status",
      ]);
    assert.ok(
      !JSON.stringify(data).match(
        /PRIVATE_|NEVER_RETURN|example\.invalid|dateOfBirth|passwordReset|emailVerifiedAt/,
      ),
    );
  }
  assert.equal(accounts.items[0].label, "<script>Safe text</script>");
  assert.ok(accounts.items.some((i) => i.status === "parent-pending"));
  assert.ok(accounts.items.some((i) => i.status === "email-pending"));
  assert.equal(videoList.items[0].status, "deletion-pending");
  assert.ok(videoList.items.some((i) => i.status === "archived"));
  if (process.argv.includes("--connector")) {
    const { signedReadHeaders } = await import(
      pathToFileURL(
        join(
          process.cwd(),
          "../Super Admin/lib/integrations/admin-signature.ts",
        ),
      ).href
    );
    for (const resource of ["manifest", "accounts", "videos", "jobs"]) {
      const signed = signedReadHeaders(
        { projectId, environment: "local", audience: base, keyId },
        "/api/admin/v1/" + resource,
        secret,
      );
      await request(resource, { unsigned: true, headers: signed });
      await request(resource, { unsigned: true, headers: signed, status: 404 });
    }
  }
  const securitySnapshot = async () =>
    JSON.stringify(
      await Promise.all(
        ["auth_rate_limits", "adminnonces"].map((name) =>
          db.collection(name).find({}).sort({ _id: 1 }).toArray(),
        ),
      ),
    );
  const securityBefore = await securitySnapshot();
  await db.command({ profile: 2 });
  for (const resource of ["manifest", "accounts", "videos", "jobs"])
    await request(resource, { unsigned: true, status: 404 });
  for (const header of [
    "Version",
    "Scope",
    "Project",
    "Environment",
    "Audience",
    "Key-Id",
    "Time",
    "Nonce",
    "Signature",
  ])
    await request("accounts", {
      headers: { ["X-Admin-" + header]: "" },
      status: 404,
    });
  await request("accounts", {
    headers: { "X-Admin-Key-Id": "key-current, key-current" },
    status: 404,
  });
  const customer = await encode({
    token: { id: String(users[0]._id), sessionVersion: 0 },
    secret: authSecret,
  });
  await request("accounts", {
    unsigned: true,
    headers: { Cookie: "next-auth.session-token=" + customer },
    status: 404,
  });
  await request("accounts", {
    secret: randomBytes(32).toString("hex"),
    status: 404,
  });
  await request("accounts", {
    headers: { "X-Admin-Project": "another-project" },
    status: 404,
  });
  for (const offset of [-61, 61])
    await request("accounts", {
      time: String(Math.floor(Date.now() / 1000) + offset),
      status: 404,
    });
  await request("accounts", { nonce: "not-a-uuid", status: 404 });
  await request("accounts", {
    headers: { "X-Admin-Signature": "invalid" },
    status: 404,
  });
  await request("videos", {
    headers: headers("/api/admin/v1/accounts"),
    status: 404,
  });
  for (const name of ["Version", "Scope", "Environment", "Audience", "Key-Id"])
    await request("accounts", {
      headers: { ["X-Admin-" + name]: "tampered" },
      status: 404,
    });
  // Correctly re-signing for another service/environment is still denied.
  for (const identity of [
    { environment: "production" },
    { audience: "https://other.invalid" },
    { projectId: "other" },
  ])
    await request("accounts", { identity, status: 404 });
  const legacy = headers("/api/admin/v1/accounts");
  legacy["X-Admin-Signature"] = createHmac("sha256", secret)
    .update(
      [
        "GET",
        "/api/admin/v1/accounts",
        legacy["X-Admin-Time"],
        legacy["X-Admin-Nonce"],
        "",
      ].join("\n"),
    )
    .digest("hex");
  await request("accounts", { headers: legacy, status: 404 });
  await request("accounts", {
    unsigned: true,
    headers: { Authorization: "Bearer " + secret },
    status: 404,
  });
  await request("accounts?limit=100000", { status: 404 });
  await request("accounts?filter[$ne]=1", { status: 404 });
  await new Promise((resolve, reject) => {
    const path = "/api/admin/v1/accounts";
    const r = httpRequest(
      base + path,
      { method: "GET", headers: { ...headers(path), "Content-Length": "2" } },
      (response) => {
        response.resume();
        try {
          assert.equal(
            response.statusCode,
            404,
            "A signed GET with a body must be rejected",
          );
          assert.equal(response.headers["cache-control"], "no-store");
          checks++;
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );
    r.on("error", reject);
    r.setTimeout(10000, () =>
      r.destroy(Error("Body rejection test timed out")),
    );
    r.end("{}");
  });
  await db.command({ profile: 0 });
  assert.equal(
    await securitySnapshot(),
    securityBefore,
    "Invalid authorization cannot write counters/nonces",
  );
  assert.equal(
    await db.collection("system.profile").countDocuments({
      "command.find": { $in: ["users", "videos", "emailjobs"] },
    }),
    0,
    "Invalid authorization never queries private collections",
  );
  await request("actions", { status: 404 });
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"])
    for (const resource of [
      "manifest",
      "accounts",
      "videos",
      "jobs",
      "actions",
    ])
      await request(resource, { method, status: 404 });
  for (const path of [
    "/api/admin",
    "/api/admin/v2/accounts",
    "/api/admin/v1/accounts/extra",
  ]) {
    const r = await fetch(base + path, { redirect: "manual" });
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: "Not found" });
    assert.equal(r.headers.get("cache-control"), "no-store");
    checks++;
  }
  await request("actions", { method: "POST", status: 404 });
  const nonce = randomUUID();
  await request("accounts", { nonce });
  await request("accounts", { nonce, status: 404 });
  await request("videos", { nonce, status: 404 });
  const race = headers("/api/admin/v1/accounts");
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () =>
      fetch(base + "/api/admin/v1/accounts", { headers: race }),
    ),
  );
  assert.equal(concurrent.filter((r) => r.status === 200).length, 1);
  assert.equal(concurrent.filter((r) => r.status === 404).length, 7);
  checks += 8;
  const indexes = await db.collection("adminnonces").indexes();
  assert.ok(
    indexes.some((i) => i.expireAfterSeconds === 0 && i.key.expiresAt === 1),
  );
  const nonceDocs = await db.collection("adminnonces").find({}).toArray();
  assert.ok(
    nonceDocs.every(
      (n) =>
        n.expiresAt instanceof Date &&
        n.expiresAt.getTime() <= Date.now() + 121000,
    ),
  );
  assert.ok(!JSON.stringify(nonceDocs).includes(nonce));
  assert.equal(
    await snapshot(),
    before,
    "Admin reads must not alter customers, media or email jobs",
  );
  // Seed the isolated account counter at its limit. No load test of real services.
  const seconds = 60;
  const window = Math.floor(Date.now() / (seconds * 1000));
  const rateId = createHmac("sha256", authSecret)
    .update(`admin-read:account:${window}:${projectId}`)
    .digest("hex");
  await db
    .collection("auth_rate_limits")
    .updateOne(
      { _id: rateId },
      { $set: { count: 120, expiresAt: new Date(Date.now() + 120000) } },
      { upsert: true },
    );
  const blocked = await request("manifest", { status: 429 });
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  await request("accounts", {
    status: 429,
    headers: { "x-forwarded-for": "198.51.100.123" },
  });
  await db.collection("auth_rate_limits").deleteMany({});
  const overlap = {
    REELOGRAM_ADMIN_PREVIOUS_KEY_ID: previousKeyId,
    REELOGRAM_ADMIN_PREVIOUS_SECRET: previousSecret,
    REELOGRAM_ADMIN_PREVIOUS_VALID_UNTIL: new Date(Date.now() + 3600000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z"),
  };
  await start(overlap);
  const rotationNonce = randomUUID();
  await request("accounts", { nonce: rotationNonce });
  await request("accounts", {
    nonce: rotationNonce,
    keyId: previousKeyId,
    secret: previousSecret,
    status: 404,
  });
  await request("manifest", { keyId: previousKeyId, secret: previousSecret });
  await request("manifest", { keyId, secret: previousSecret, status: 404 });
  const rotationWindow = Math.floor(Date.now() / 60000);
  await db.collection("auth_rate_limits").updateOne(
    {
      _id: createHmac("sha256", authSecret)
        .update(`admin-read:account:${rotationWindow}:${projectId}`)
        .digest("hex"),
    },
    { $set: { count: 120, expiresAt: new Date(Date.now() + 120000) } },
    { upsert: true },
  );
  await request("manifest", {
    keyId: previousKeyId,
    secret: previousSecret,
    status: 429,
  });
  await db.collection("auth_rate_limits").deleteMany({});
  await start({
    ...overlap,
    REELOGRAM_ADMIN_PREVIOUS_VALID_UNTIL: "2020-01-01T00:00:00Z",
  });
  await request("manifest", {
    keyId: previousKeyId,
    secret: previousSecret,
    status: 404,
  });
  await request("manifest");
  await start(); // removal revokes even within the previous overlap window
  await request("manifest", {
    keyId: previousKeyId,
    secret: previousSecret,
    status: 404,
  });
  await request("accounts", { nonce: rotationNonce, status: 404 }); // replay survives process restart
  await request("manifest");
  const auditLines = logs
    .split("\n")
    .filter((line) => line.startsWith('{"event":"admin.read"'))
    .map((line) => JSON.parse(line));
  assert.ok(auditLines.some((line) => line.status === 200));
  assert.ok(auditLines.some((line) => line.status === 404));
  for (const line of auditLines) {
    assert.deepEqual(Object.keys(line).sort(), [
      "at",
      "credentialId",
      "environment",
      "event",
      "projectId",
      "resource",
      "status",
    ]);
    assert.ok(!JSON.stringify(line).includes(rotationNonce));
    assert.ok(!JSON.stringify(line).includes(secret));
  }
  await start({ REELOGRAM_ADMIN_ENABLED: "0" });
  await request("accounts", { status: 404 });
  await start({ REELOGRAM_ADMIN_SECRET: authSecret });
  await request("manifest", { status: 404 });
  await start(
    {
      REELOGRAM_REDIS_DISABLED: "0",
      REELOGRAM_KV_REST_API_URL: "https://isolated-test.upstash.io",
      REELOGRAM_KV_REST_API_TOKEN: "synthetic-token",
    },
    true,
  );
  const counterSnapshot = JSON.stringify(
    await db.collection("auth_rate_limits").find({}).sort({ _id: 1 }).toArray(),
  );
  const nonceCount = await db.collection("adminnonces").countDocuments({});
  for (const mode of ["network", "timeout", "quota", "command", "malformed"]) {
    await writeFile(faultFile, mode);
    await request("accounts", { unsigned: true, status: 404 });
    const r = await request("accounts", { status: 503 });
    assert.equal(r.headers.get("retry-after"), "30");
  }
  assert.equal(
    await db.collection("adminnonces").countDocuments({}),
    nonceCount,
  );
  assert.equal(
    JSON.stringify(
      await db
        .collection("auth_rate_limits")
        .find({})
        .sort({ _id: 1 })
        .toArray(),
    ),
    counterSnapshot,
    "Configured Redis failure never resets Mongo limits",
  );
  await db.collection("auth_rate_limits").deleteMany({}); // isolated database only
  await start();
  await request("manifest");
  assert.equal(await snapshot(), before);
  await database.stop();
  await request("accounts", { unsigned: true, status: 404 });
  const failed = await request("accounts", { status: 503 });
  assert.ok(
    !JSON.stringify(await failed.json()).match(/mongodb|127\.0\.0\.1|stack/i),
  );
  console.log(
    `PASS: ${checks} ${production ? "production" : "development"} admin HTTP checks: signed contract, private projections, bounded reads, replay/concurrency, method denial, disabled configuration, throttling, Redis/Mongo outages and recovery.`,
  );
} catch (error) {
  console.error("Admin integration check failed:", error.message);
  // Test logs contain no request credentials or payloads.
  if (!server || server.exitCode !== null) console.error(logs);
  process.exitCode = 1;
} finally {
  await stop();
  await mongoose.disconnect();
  if (database) await database.stop();
  await rm(".e2e.tsconfig.json", { force: true });
  await rm(faultFile, { force: true });
}
