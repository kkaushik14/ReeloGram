import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { resolve } from "node:path";
import { SignJWT } from "jose";
import { encode } from "next-auth/jwt";
import { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { actionServer } from "./testing/admin-action-server.mjs";
let h,
  checks = 0;
const faultFile = `/private/tmp/reelogram-upload-fault-${process.pid}`;
const signingKey = randomBytes(32).toString("hex");
const check = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
async function fault(mode = "") {
  await writeFile(faultFile, mode);
}
let cookie, otherCookie;
async function call(
  path,
  { method = "GET", body, auth = cookie, status = 200, headers = {} } = {},
) {
  const r = await fetch(h.base + path, {
    method: body ? "POST" : method,
    headers: {
      ...(auth ? { Cookie: auth } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => null);
  assert.equal(
    r.status,
    status,
    `${path}: ${r.status} ${JSON.stringify(data)}`,
  );
  checks++;
  return data;
}
async function owner() {
  const _id = new Types.ObjectId();
  await h.db.collection("users").insertOne({
    _id,
    email: `${_id}@example.invalid`,
    name: "Upload Test",
    password: await bcrypt.hash("legacy-pass", 10),
    dateOfBirth: new Date("1998-01-01"),
    emailVerifiedAt: new Date(),
    sessionVersion: 0,
  });
  return {
    id: String(_id),
    cookie: `next-auth.session-token=${await encode({ secret: h.config.authSecret, token: { id: String(_id), sub: String(_id), email: `${_id}@example.invalid`, sessionVersion: 0 }, maxAge: 3600 })}`,
  };
}
async function asset(kind = "video") {
  return call("/api/uploads", {
    body: {
      kind,
      size: 32,
      mime: kind === "video" ? "video/mp4" : "image/png",
    },
    status: 201,
  });
}
async function complete(id) {
  return call(`/api/uploads/${id}`, { body: { action: "complete" } });
}
async function processJob(id, status = 503, mutate = false, advance = true) {
  // Advance only the test database clock for retries; production must honor backoff.
  if (advance && !mutate)
    await h.db
      .collection("upload_jobs")
      .updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { nextRetryAt: new Date(0) } },
      );
  const body = JSON.stringify({ id });
  const signature = await new SignJWT({
    body: createHash("sha256").update(body).digest("base64url"),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("Upstash")
    .setSubject(h.base + "/api/uploads/process")
    .setNotBefore(Math.floor(Date.now() / 1000) - 1)
    .setExpirationTime("2m")
    .sign(new TextEncoder().encode(signingKey));
  return call("/api/uploads/process", {
    auth: null,
    body: { id: mutate ? String(new Types.ObjectId()) : id },
    status,
    headers: { "Upstash-Signature": signature },
  });
}
try {
  h = await actionServer();
  await fault();
  await h.start({
    NODE_OPTIONS: `--import ${JSON.stringify(resolve("scripts/testing/upload-faults.mjs"))}`,
    REELOGRAM_UPLOAD_FAULT_FILE: faultFile,
    REELOGRAM_RESUMABLE_UPLOADS: "1",
    REELOGRAM_R2_ACCOUNT_ID: "a".repeat(32),
    REELOGRAM_R2_BUCKET: "upload-test",
    REELOGRAM_R2_ACCESS_KEY_ID: "test",
    REELOGRAM_R2_SECRET_ACCESS_KEY: "test",
    REELOGRAM_QSTASH_TOKEN: "synthetic",
    REELOGRAM_QSTASH_URL: "https://qstash.upstash.io",
    REELOGRAM_QSTASH_CURRENT_SIGNING_KEY: signingKey,
    REELOGRAM_QSTASH_NEXT_SIGNING_KEY: signingKey,
    REELOGRAM_PRIVATE_KEY: "synthetic",
    REELOGRAM_NEXT_PUBLIC_PUBLIC_KEY: "synthetic",
    REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT: "https://ik.imagekit.io/test",
    REELOGRAM_EMAIL_PROVIDER: "disabled",
    REELOGRAM_EMAIL_FROM: "test@example.invalid",
  });
  const primary = await owner(),
    other = await owner();
  cookie = primary.cookie;
  otherCookie = other.cookie;
  await call("/api/uploads", { auth: null, body: {}, status: 401 });
  await call("/api/uploads", {
    body: { kind: "video", size: 32, mime: "video/mp4" },
    headers: { Origin: "https://attacker.invalid" },
    status: 403,
  });
  for (const size of [-1, 0, 104857601])
    await call("/api/uploads", {
      body: { kind: "video", size, mime: "video/mp4" },
      status: 400,
    });
  const video = await asset();
  await call(`/api/uploads/${video.id}`, { auth: otherCookie, status: 404 });
  await call(`/api/uploads/${video.id}`, {
    auth: otherCookie,
    body: { action: "sign", parts: [1] },
    status: 404,
  });
  await call(`/api/uploads/${video.id}`, {
    body: { action: "sign", parts: [1, 1] },
    status: 400,
  });
  await call(`/api/uploads/${video.id}`, {
    body: { action: "sign", parts: [2] },
    status: 400,
  });
  const signed = await call(`/api/uploads/${video.id}`, {
    body: { action: "sign", parts: [1] },
  });
  check(signed.parts.length, 1);
  assert.ok(signed.parts[0].url.includes("X-Amz-Signature="));
  checks++;
  await fault("missing-parts");
  await call(`/api/uploads/${video.id}`, {
    body: { action: "complete" },
    status: 400,
  });
  await fault("wrong-size");
  await call(`/api/uploads/${video.id}`, {
    body: { action: "complete" },
    status: 400,
  });
  await fault();
  await complete(video.id);
  await complete(video.id);
  const image = await asset("image");
  await complete(image.id);
  const input = {
    video: video.id,
    image: image.id,
    title: "Saved upload",
    description: "A regression upload",
  };
  await call("/api/uploads/jobs", {
    auth: otherCookie,
    body: input,
    status: 409,
  });
  await fault("queue-down");
  const job = await call("/api/uploads/jobs", { body: input, status: 202 });
  check(job.status, "queued");
  check(await h.db.collection("videos").countDocuments({}), 0);
  await call(`/api/uploads/${video.id}`, { method: "DELETE", status: 409 });
  await fault();
  await call("/api/uploads/jobs", { body: input, status: 202 });
  await call("/api/uploads/jobs", {
    body: { ...input, title: "Changed" },
    status: 409,
  });
  await call("/api/uploads/process", {
    body: { id: job.id },
    auth: null,
    status: 404,
  });
  await processJob(job.id, 404, true);
  await fault("imagekit-down");
  await processJob(job.id);
  const beforeReplay = await h.db
    .collection("upload_jobs")
    .findOne({ _id: new Types.ObjectId(job.id) });
  await processJob(job.id, 503, false, false);
  check(
    (
      await h.db
        .collection("upload_jobs")
        .findOne({ _id: new Types.ObjectId(job.id) })
    ).failures,
    beforeReplay.failures,
  );
  check(
    (
      await h.db
        .collection("upload_jobs")
        .findOne({ _id: new Types.ObjectId(job.id) })
    ).status,
    "processing",
  );
  await fault("lost-transfer-response");
  await processJob(job.id); // File saved but provider response lost.
  await fault();
  await processJob(job.id); // Reconciles exact path, no second file.
  await processJob(job.id); // Cover.
  await processJob(job.id, 200); // Publication.
  await processJob(job.id, 200); // Replay is harmless.
  check(await h.db.collection("videos").countDocuments({}), 1);
  const stored = await h.db
    .collection("upload_jobs")
    .findOne({ _id: new Types.ObjectId(job.id) });
  check(stored.status, "published");
  const otherJobs = await call("/api/uploads/jobs", { auth: otherCookie });
  check(otherJobs.jobs.length, 0);
  const cancelled = await asset();
  await call(`/api/uploads/${cancelled.id}`, { method: "DELETE" });
  await call(`/api/uploads/${cancelled.id}`, {
    body: { action: "sign", parts: [1] },
    status: 410,
  });
  const invalid = await asset();
  await fault("bad-signature");
  await call(`/api/uploads/${invalid.id}`, {
    body: { action: "complete" },
    status: 400,
  });
  await fault();
  const suspendedVideo = await asset(),
    suspendedImage = await asset("image");
  await complete(suspendedVideo.id);
  await complete(suspendedImage.id);
  const suspendedJob = await call("/api/uploads/jobs", {
    body: { ...input, video: suspendedVideo.id, image: suspendedImage.id },
    status: 202,
  });
  await h.db
    .collection("users")
    .updateOne(
      { _id: new Types.ObjectId(primary.id) },
      { $set: { suspended: true }, $inc: { sessionVersion: 1 } },
    );
  await processJob(suspendedJob.id, 200);
  check(
    (
      await h.db
        .collection("upload_jobs")
        .findOne({ _id: new Types.ObjectId(suspendedJob.id) })
    ).status,
    "failed",
  );
  check(await h.db.collection("videos").countDocuments({}), 1);
  for (const password of [
    "short",
    "password123456789",
    "x".repeat(20),
    "Copper sails beyond winter1!",
    "Copper sails beyond winter12",
  ]) {
    await call("/api/auth/register", {
      auth: null,
      body: {
        email: "a@example.com",
        name: "Test",
        dateOfBirth: "1998-01-01",
        password,
      },
      status: 400,
    });
    await call("/api/auth/reset-password", {
      auth: null,
      body: { token: "a".repeat(43), password },
      status: 400,
    });
  }
  const resetToken = randomBytes(32).toString("base64url");
  const resetDigest = createHash("sha256").update(resetToken).digest("hex");
  await h.db
    .collection("users")
    .updateOne(
      { _id: new Types.ObjectId(other.id) },
      {
        $set: {
          passwordReset: {
            digest: resetDigest,
            expiresAt: new Date(Date.now() + 60000),
          },
        },
      },
    );
  await call("/api/auth/reset-password", {
    auth: null,
    body: { token: resetToken, password: "Ceda27!" },
    status: 400,
  });
  check(
    (
      await h.db
        .collection("users")
        .findOne({ _id: new Types.ObjectId(other.id) })
    ).passwordReset.digest,
    resetDigest,
  );
  await call("/api/auth/reset-password", {
    auth: null,
    body: { token: resetToken, password: "Cedar27!" },
  });
  check(
    await bcrypt.compare(
      "Cedar27!",
      (
        await h.db
          .collection("users")
          .findOne({ _id: new Types.ObjectId(other.id) })
      ).password,
    ),
    true,
  );
  await call("/api/auth/reset-password", {
    auth: null,
    body: { token: resetToken, password: "Birch28!" },
    status: 400,
  });
  console.log(
    `Staged upload HTTP regression passed: ${checks} checks; no real provider requests or production records.`,
  );
} catch (error) {
  console.error(error);
  if (h) console.error(h.logs);
  process.exitCode = 1;
} finally {
  if (h) await h.close();
  await rm(faultFile, { force: true });
}
