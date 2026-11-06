import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { encode } from "next-auth/jwt";
import { actionServer } from "./testing/admin-action-server.mjs";
import { executeAction } from "../lib/admin/actions/execute.ts";
import { withPublishingAccount } from "../lib/account/publishing-guard.ts";
import { readPublicData } from "../lib/cache/public-data.ts";
let h,
  checks = 0;
const check = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
const oid = () => new mongoose.Types.ObjectId();
function signed(path, body = "", options = {}) {
  const scope = options.scope || "actions",
    method = options.method || (body ? "POST" : "GET"),
    time = String(Math.floor(Date.now() / 1000)),
    nonce = options.nonce || randomUUID();
  const key = scope === "read" ? h.config.readKey : h.config.writeKey,
    secret = scope === "read" ? h.config.readSecret : h.config.writeSecret;
  const payload = JSON.stringify([
    "reelogram-admin",
    "2",
    scope,
    h.config.projectId,
    "local",
    h.base,
    key,
    method,
    path,
    time,
    nonce,
    createHash("sha256").update(body).digest("hex"),
  ]);
  return {
    "Content-Type": "application/json",
    "X-Admin-Version": "2",
    "X-Admin-Scope": scope,
    "X-Admin-Project": h.config.projectId,
    "X-Admin-Environment": "local",
    "X-Admin-Audience": h.base,
    "X-Admin-Key-Id": key,
    "X-Admin-Time": time,
    "X-Admin-Nonce": nonce,
    "X-Admin-Signature": createHmac("sha256", secret)
      .update(payload)
      .digest("hex"),
    ...options.headers,
  };
}
async function request(
  path,
  {
    body,
    method = body ? "POST" : "GET",
    expected = 200,
    headers = {},
    auth = true,
    scope = "actions",
    nonce,
  } = {},
) {
  const raw =
    body === undefined
      ? ""
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  const r = await fetch(h.base + path, {
    method,
    headers: {
      ...(auth ? signed(path, raw, { scope, method, nonce }) : {}),
      ...headers,
    },
    ...(method === "GET" || method === "HEAD" ? {} : { body: raw }),
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(
    r.status,
    expected,
    `${method} ${path}: ${await r.clone().text()}`,
  );
  checks++;
  if (path.startsWith("/api/admin/")) {
    check(r.headers.get("cache-control"), "no-store");
    if (expected === 404) check(await r.clone().json(), { error: "Not found" });
  }
  return r;
}
const action = (action, target, revision = 0) => ({
  commandId: randomUUID(),
  action,
  target: String(target),
  reason: "Moderation test with verified evidence",
  actor: h.config.owner,
  authorizedAt: Math.floor(Date.now() / 1000),
  expectedRevision: revision,
});
const send = async (body, options = {}) =>
  (await request("/api/admin/v1/actions", { body, ...options })).json();
const clearLimits = () => h.db.collection("auth_rate_limits").deleteMany({});
const identity = () => ({
  projectId: h.config.projectId,
  environment: "local",
  keyId: h.config.writeKey,
  nonce: randomUUID(),
});
const cookie = async (user, version = 0) =>
  "next-auth.session-token=" +
  (await encode({
    token: { id: String(user), sessionVersion: version },
    secret: h.config.authSecret,
  }));
try {
  h = await actionServer();
  const users = h.db.collection("users"),
    videos = h.db.collection("videos"),
    receipts = h.db.collection("admincommands");
  const user = oid(),
    other = oid(),
    video = oid(),
    hero = oid(),
    archived = oid(),
    deleting = oid();
  const password = "A-safe-test-password-123";
  await users.insertMany([
    {
      _id: user,
      email: "owner@example.invalid",
      password: await bcrypt.hash(password, 10),
      name: "Test owner",
      dateOfBirth: new Date("1990-01-01"),
      emailVerifiedAt: new Date(),
      sessionVersion: 0,
      signInGrant: {
        digest: "old-grant",
        expiresAt: new Date(Date.now() + 60000),
      },
      passwordReset: {
        digest: "old-reset",
        expiresAt: new Date(Date.now() + 60000),
      },
      parent: {
        email: "private@example.invalid",
        verifiedAt: new Date(),
        ownerApprovedAt: new Date(),
      },
    },
    {
      _id: other,
      email: "other@example.invalid",
      name: "Other",
      dateOfBirth: new Date("1990-01-01"),
      emailVerifiedAt: new Date(),
      sessionVersion: 0,
    },
  ]);
  const media = {
    title: "Visible test video",
    description: "Safe isolated fixture",
    videoUrl: "https://ik.imagekit.io/example/movie.mp4",
    thumbNailUrl: "https://ik.imagekit.io/example/cover.jpg",
    uploadedBy: user,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await videos.insertMany([
    { ...media, _id: video, placement: "feed" },
    { ...media, _id: hero, placement: "hero" },
    { ...media, _id: archived, placement: "archived" },
    { ...media, _id: deleting, placement: "feed", deletionPending: true },
  ]);
  await h.start();
  const manifest = await (
    await request("/api/admin/v1/manifest", { scope: "read" })
  ).json();
  check(manifest.capabilities, [
    "accounts.read",
    "videos.read",
    "jobs.read",
    "accounts.suspend",
    "accounts.restore",
    "videos.hide",
    "videos.restore",
  ]);
  const original = JSON.stringify(await users.findOne({ _id: user }));
  const cmd = action("accounts.suspend", user);
  await send(cmd, { expected: 404, auth: false });
  await send(cmd, { expected: 404, scope: "read" });
  await request("/api/admin/v1/accounts", { expected: 404 });
  await send({ ...cmd, actor: "google:other" }, { expected: 404 });
  await send({ ...cmd, authorizedAt: 0 }, { expected: 404 });
  await send({ ...cmd, reason: "x" }, { expected: 400 });
  await send({ ...cmd, target: { $ne: null } }, { expected: 400 });
  await send({ ...cmd, force: true }, { expected: 400 });
  const tampered = JSON.stringify({ ...cmd, action: "accounts.restore" });
  await request("/api/admin/v1/actions", {
    body: tampered,
    headers: signed("/api/admin/v1/actions", JSON.stringify(cmd)),
    expected: 404,
  });
  await request("/api/admin/v1/actions?x=1", {
    body: cmd,
    headers: signed("/api/admin/v1/actions", JSON.stringify(cmd)),
    expected: 404,
  });
  check(JSON.stringify(await users.findOne({ _id: user })), original);
  check(await receipts.countDocuments({}), 0);
  const token0 = await cookie(user);
  check(
    (
      await request("/api/account", {
        auth: false,
        headers: { Cookie: token0 },
      })
    ).status,
    200,
  );
  const sameNonce = randomUUID();
  const suspended = await send(cmd, { nonce: sameNonce });
  check(suspended.status, "succeeded");
  check(suspended.revision, 1);
  check(suspended.changed, true);
  const noOp = await send(action("accounts.suspend", user, 1));
  check(noOp.code, "already-in-state");
  check(noOp.changed, false);
  check(noOp.revision, 1);
  await send(cmd, { nonce: sameNonce, expected: 404 });
  check(await send(cmd), suspended);
  await send({ ...cmd, reason: "A conflicting request" }, { expected: 409 });
  const stored = await users.findOne({ _id: user });
  check(stored.suspended, true);
  check(stored.sessionVersion, 1);
  check(stored.signInGrant, undefined);
  check(stored.passwordReset, undefined);
  assert(stored.parent.verifiedAt);
  for (const path of [
    "/api/account",
    "/api/imagekit-auth",
    "/api/videos?mine=true",
  ])
    await request(path, {
      auth: false,
      headers: { Cookie: token0 },
      expected: 401,
    });
  await request("/api/videos", {
    auth: false,
    body: { title: "Cannot publish" },
    headers: { Cookie: token0, "Content-Type": "application/json" },
    expected: 401,
  });
  const csrfResponse = await fetch(h.base + "/api/auth/csrf");
  const csrf = (await csrfResponse.json()).csrfToken;
  const csrfCookie = csrfResponse.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  await request("/api/auth/callback/credentials", {
    auth: false,
    body: new URLSearchParams({
      csrfToken: csrf,
      email: "owner@example.invalid",
      password,
      json: "true",
    }).toString(),
    headers: {
      Cookie: csrfCookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    expected: 401,
  });
  check(
    (
      await (await request("/api/admin/v1/accounts", { scope: "read" })).json()
    ).items.find((i) => i.id === String(user)).status,
    "suspended",
  );
  check(
    (await send(action("accounts.restore", user, 0))).code,
    "stale-revision",
  );
  check((await send(action("accounts.restore", user, 1))).revision, 2);
  await request("/api/account", {
    auth: false,
    headers: { Cookie: token0 },
    expected: 401,
  });
  const token2 = await cookie(user, 2);
  await request("/api/account", { auth: false, headers: { Cookie: token2 } });
  const active = await users.findOne({ _id: user });
  check(active.suspended, false);
  check(active.sessionVersion, 2);
  check(active.emailVerifiedAt.getTime(), stored.emailVerifiedAt.getTime());
  await clearLimits();
  // Same command under concurrent fresh signatures is applied/audited exactly once.
  const concurrentCmd = action("accounts.suspend", user, 2);
  const outcomes = await Promise.all(
    Array.from({ length: 6 }, () => send(concurrentCmd)),
  );
  assert(
    outcomes.every((x) => JSON.stringify(x) === JSON.stringify(outcomes[0])),
  );
  checks++;
  check((await users.findOne({ _id: user })).sessionVersion, 3);
  check(
    await receipts.countDocuments({ commandId: concurrentCmd.commandId }),
    1,
  );
  const statusPath = "/api/admin/v1/actions/" + concurrentCmd.commandId;
  check(await (await request(statusPath)).json(), outcomes[0]);
  await request(statusPath, { scope: "read", expected: 404 });
  // Restoration never makes the old command executable again.
  await send(action("accounts.restore", user, 3));
  check(await send(concurrentCmd), outcomes[0]);
  check((await users.findOne({ _id: user })).suspended, false);
  await request("/api/admin/v1/actions/" + randomUUID(), { expected: 404 });
  await clearLimits();
  const hidden = await send(action("videos.hide", video));
  check(hidden.status, "succeeded");
  check(hidden.revision, 1);
  const feed = await (await request("/api/videos", { auth: false })).json();
  assert(!JSON.stringify(feed).includes(String(video)));
  checks++;
  await request("/api/videos/" + video, { auth: false, expected: 404 });
  await request("/videos/" + video, { auth: false, expected: 404 });
  const map = await request("/sitemaps/videos-0.xml", {
    auth: false,
    expected: 404,
  });
  check(map.status, 404);
  // Owners can still manage their own hidden post, but cannot clear moderation fields.
  const token4 = await cookie(user, 4);
  const mine = await (
    await request("/api/videos?mine=true", {
      auth: false,
      headers: { Cookie: token4 },
    })
  ).json();
  assert(JSON.stringify(mine).includes(String(video)));
  checks++;
  await request("/api/videos/" + video, {
    method: "PATCH",
    body: { hidden: false },
    auth: false,
    headers: { Cookie: token4, "Content-Type": "application/json" },
    expected: 400,
  });
  await request("/api/videos/" + video, {
    method: "PATCH",
    body: { title: "Owner edit preserves moderation" },
    auth: false,
    headers: { Cookie: token4, "Content-Type": "application/json" },
  });
  check((await videos.findOne({ _id: video })).hidden, true);
  await send(action("videos.hide", hero));
  const showcase = await (
    await request("/api/showcase", { auth: false })
  ).json();
  check(showcase.videos.length, 0);
  check((await send(action("videos.restore", video, 1))).status, "succeeded");
  await request("/api/videos/" + video, { auth: false });
  await request("/videos/" + video, { auth: false });
  const xml = await (
    await request("/sitemaps/videos-0.xml", { auth: false })
  ).text();
  assert(xml.includes(String(video)));
  checks++;
  await send(action("videos.restore", hero, 1));
  check(
    (await (await request("/api/showcase", { auth: false })).json()).videos
      .length,
    1,
  );
  await send(action("videos.hide", archived));
  await send(action("videos.restore", archived, 1));
  await request("/api/videos/" + archived, { auth: false, expected: 404 });
  check((await videos.findOne({ _id: archived })).placement, "archived");
  check(
    (await send(action("videos.restore", deleting))).code,
    "deletion-in-progress",
  );
  check((await send(action("videos.hide", oid()))).code, "target-not-found");
  // No provider/media writes: fields and file locations survive hide/restore.
  check((await videos.findOne({ _id: video })).videoUrl, media.videoUrl);
  await clearLimits();
  // Force audit insertion failure in the disposable DB: target write must roll back.
  await h.db.command({
    collMod: "admincommands",
    validator: { $jsonSchema: { required: ["impossibleAuditField"] } },
    validationLevel: "strict",
  });
  const beforeAuditFailure = JSON.stringify(
    await users.findOne({ _id: other }),
  );
  await send(action("accounts.suspend", other), { expected: 503 });
  check(
    JSON.stringify(await users.findOne({ _id: other })),
    beforeAuditFailure,
  );
  await h.db.command({
    collMod: "admincommands",
    validator: {},
    validationLevel: "strict",
  });
  // Publication is fenced against suspension in the same transaction order.
  await executeAction(action("accounts.suspend", other), identity());
  await assert.rejects(
    () =>
      withPublishingAccount(String(other), 0, async () => {
        throw Error("Should not run");
      }),
    (e) => e.status === 403,
  );
  checks++;
  await executeAction(action("accounts.restore", other, 1), identity());
  await assert.rejects(
    () => withPublishingAccount(String(other), 0, async () => {}),
    (e) => e.status === 403,
  );
  checks++;
  const published = oid();
  let entered;
  const inside = new Promise((r) => (entered = r));
  let release;
  const gate = new Promise((r) => (release = r));
  const publishing = withPublishingAccount(
    String(other),
    2,
    async (session) => {
      entered();
      await gate;
      await videos.insertOne(
        { ...media, _id: published, uploadedBy: other, placement: "feed" },
        { session },
      );
      return String(published);
    },
  );
  await inside;
  const suspending = executeAction(
    action("accounts.suspend", other, 2),
    identity(),
  );
  release();
  await publishing;
  await suspending;
  check((await users.findOne({ _id: other })).suspended, true);
  check(await videos.countDocuments({ _id: published }), 1);
  await assert.rejects(
    () => withPublishingAccount(String(other), 2, async () => {}),
    (e) => e.status === 403,
  );
  checks++;
  await clearLimits();
  const competing = await Promise.all([
    send(action("accounts.restore", other, 3)),
    send(action("accounts.restore", other, 3)),
  ]);
  check(competing.map((r) => r.code).sort(), ["applied", "stale-revision"]);
  check((await users.findOne({ _id: other })).sessionVersion, 4);
  // Cache fence must invalidate an already-cached public feed before the action.
  const nativeFetch = globalThis.fetch;
  let generation = "old",
    cached = JSON.stringify({ items: [String(video)] }),
    writes = 0;
  process.env.REELOGRAM_REDIS_DISABLED = "0";
  process.env.REELOGRAM_KV_REST_API_URL = "https://isolated-test.upstash.io";
  process.env.REELOGRAM_KV_REST_API_TOKEN = "synthetic-token";
  globalThis.fetch = async (input, options) => {
    if (String(input) !== "https://isolated-test.upstash.io")
      return nativeFetch(input, options);
    const [, script, count, ...args] = JSON.parse(options.body);
    const argv = args.slice(count);
    if (script.includes("ZADD")) {
      generation = argv[0];
      cached = "";
      writes++;
      return Response.json({ result: 1 });
    }
    if (script.includes("ZREM',")) {
      generation = argv[0];
      cached = "";
      return Response.json({ result: 1 });
    }
    if (script.includes("ZCARD"))
      return Response.json({ result: [generation, cached, 1] });
    return Response.json({ result: 1 });
  };
  try {
    await executeAction(action("videos.hide", video, 2), identity());
    check(writes, 1);
    const result = await readPublicData("test", async () => ({
      items: await videos.find({ hidden: { $ne: true } }).toArray(),
    }));
    assert(!JSON.stringify(result).includes(String(video)));
    checks++;
  } finally {
    globalThis.fetch = nativeFetch;
    process.env.REELOGRAM_REDIS_DISABLED = "1";
  }
  // Every committed/rejected intent has an immutable receipt without secrets/nonces.
  const all = await receipts.find({}).toArray();
  assert(
    all.every(
      (r) =>
        r.actor === h.config.owner &&
        ["succeeded", "rejected"].includes(r.status) &&
        r.completedAt instanceof Date,
    ),
  );
  checks++;
  assert(!JSON.stringify(all).includes(h.config.writeSecret));
  assert(!JSON.stringify(all).includes(h.config.authSecret));
  check(
    (await receipts.indexes()).some((i) => i.expireAfterSeconds !== undefined),
    false,
  );
  // Explicit quota test; no fresh counters if Redis is configured but unavailable.
  const window = Math.floor(Date.now() / 60000);
  const rateId = createHmac("sha256", h.config.authSecret)
    .update(`admin-action:account:${window}:${h.config.projectId}`)
    .digest("hex");
  await h.db
    .collection("auth_rate_limits")
    .updateOne(
      { _id: rateId },
      { $set: { count: 30, expiresAt: new Date(Date.now() + 120000) } },
      { upsert: true },
    );
  await send(action("videos.restore", video, 3), { expected: 429 });
  await clearLimits();
  await h.start({ REELOGRAM_ADMIN_ACTIONS_ENABLED: "0" });
  await send(action("videos.restore", video, 3), { expected: 404 });
  check(
    (await (await request("/api/admin/v1/manifest", { scope: "read" })).json())
      .capabilities,
    ["accounts.read", "videos.read", "jobs.read"],
  );
  await h.start({ REELOGRAM_ADMIN_ACTIONS: "videos.hide" });
  await send(action("accounts.restore", other, 3), { expected: 404 });
  await h.start(
    {
      REELOGRAM_REDIS_DISABLED: "0",
      REELOGRAM_KV_REST_API_URL: "https://isolated-test.upstash.io",
      REELOGRAM_KV_REST_API_TOKEN: "synthetic-token",
    },
    true,
  );
  const recordBefore = JSON.stringify(await videos.findOne({ _id: video })),
    auditBefore = await receipts.countDocuments({});
  for (const mode of ["network", "timeout", "quota", "cache"]) {
    await h.fault(mode);
    await send(action("videos.restore", video, 3), { expected: 503 });
    check(JSON.stringify(await videos.findOne({ _id: video })), recordBefore);
    check(await receipts.countDocuments({}), auditBefore);
  }
  await h.start();
  check((await send(action("videos.restore", video, 3))).status, "succeeded");
  await h.database.stop();
  await send(action("videos.hide", video, 4), { expected: 503 });
  console.log(
    `PASS: ${checks} admin action checks: authorization, idempotency/concurrency, audit rollback, session revocation, publication races, public visibility/SEO, cache fencing, quotas and failure recovery.`,
  );
} catch (error) {
  console.error(error);
  if (h) console.error(h.logs);
  process.exitCode = 1;
} finally {
  if (h) await h.close();
}
