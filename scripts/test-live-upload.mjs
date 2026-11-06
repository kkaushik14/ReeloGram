// Opt-in provider integration test: disposable MongoDB, synthetic user/media, real R2/QStash/ImageKit.
// The temporary tunnel exposes only the two independently authenticated callback endpoints.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { encode } from "next-auth/jwt";
import { Client } from "@upstash/qstash";
import { actionServer } from "./testing/admin-action-server.mjs";
import { fixtures } from "./e2e-fixtures.mjs";
import { removeObject } from "../lib/uploads/staging/storage.ts";
import { deleteMediaFile } from "../lib/video-media.ts";
import { findTransferredAsset } from "../lib/uploads/staging/imagekit.ts";
import { progressiveVideoUrl } from "../lib/video-playback.ts";

if (
  !process.argv.includes("--live") ||
  !process.env.UPLOAD_TEST_VIDEO ||
  !process.env.UPLOAD_TEST_TUNNEL_BINARY
)
  throw Error(
    "Requires --live, UPLOAD_TEST_VIDEO (synthetic MP4), and UPLOAD_TEST_TUNNEL_BINARY (official cloudflared).",
  );
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
let h, tunnel, proxy, callback, cookie, scheduleId;
const delivered = new Map();
const qstash = new Client({
  token: process.env.REELOGRAM_QSTASH_TOKEN,
  baseUrl: process.env.REELOGRAM_QSTASH_URL,
});
async function call(path, body) {
  const response = await fetch(`http://localhost:3000${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      ...(body
        ? {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.ok(
    response.ok,
    `Local upload endpoint ${response.status}: ${data.error || "failed"}`,
  );
  return data;
}
async function stage(bytes, kind, mime) {
  const asset = await call("/api/uploads", { kind, size: bytes.length, mime });
  const count = Math.ceil(bytes.length / asset.partBytes);
  for (let part = 1; part <= count; part++) {
    const signed = await call(`/api/uploads/${asset.id}`, {
      action: "sign",
      parts: [part],
    });
    const start = (part - 1) * asset.partBytes;
    const response = await fetch(signed.parts[0].url, {
      method: "PUT",
      body: bytes.subarray(start, start + asset.partBytes),
      signal: AbortSignal.timeout(120000),
    });
    assert.equal(response.status, 200);
  }
  await call(`/api/uploads/${asset.id}`, { action: "complete" });
  return asset.id;
}
try {
  h = await actionServer({ port: 3000 });
  proxy = createServer(async (request, response) => {
    const path = request.url;
    if (
      request.method !== "POST" ||
      !["/api/uploads/process", "/api/uploads/maintenance"].includes(path) ||
      !request.headers["upstash-signature"]
    ) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024) throw Error("Too large");
        chunks.push(chunk);
      }
      const upstream = await fetch(`http://127.0.0.1:3000${path}`, {
        method: "POST",
        body: Buffer.concat(chunks),
        headers: {
          "Upstash-Signature": request.headers["upstash-signature"],
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(55000),
      });
      response.writeHead(upstream.status, {
        "Retry-After": upstream.headers.get("retry-after") || "30",
        "Cache-Control": "no-store",
      });
      response.end(await upstream.text());
      if (upstream.ok) delivered.set(path, (delivered.get(path) || 0) + 1);
    } catch {
      response.writeHead(503);
      response.end();
    }
  });
  proxy.requestTimeout = 10000;
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  tunnel = spawn(
    process.env.UPLOAD_TEST_TUNNEL_BINARY,
    [
      "tunnel",
      "--url",
      `http://127.0.0.1:${proxy.address().port}`,
      "--no-autoupdate",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  callback = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Temporary callback tunnel unavailable")),
      60000,
    );
    const observe = (chunk) => {
      const match = String(chunk).match(
        /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
      );
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    tunnel.stderr.on("data", observe);
    tunnel.stdout.on("data", observe);
  });
  await h.start({
    REELOGRAM_APP_URL: "http://localhost:3000",
    REELOGRAM_NEXTAUTH_URL: "http://localhost:3000",
    REELOGRAM_UPLOAD_CALLBACK_ORIGIN: callback,
    REELOGRAM_RESUMABLE_UPLOADS: "1",
    REELOGRAM_EMAIL_PROVIDER: "disabled",
    REELOGRAM_EMAIL_FROM: "test@example.invalid",
  });
  const _id = new Types.ObjectId();
  await h.db.collection("users").insertOne({
    _id,
    email: "upload-check@example.com",
    name: "Upload Check",
    password: await bcrypt.hash("Quiet rivers orbit violet moons", 10),
    dateOfBirth: new Date("1998-01-01"),
    emailVerifiedAt: new Date(),
    sessionVersion: 0,
  });
  cookie = `next-auth.session-token=${await encode({ secret: h.config.authSecret, token: { id: String(_id), sub: String(_id), email: "upload-check@example.com", sessionVersion: 0 }, maxAge: 3600 })}`;
  const original = await readFile(process.env.UPLOAD_TEST_VIDEO);
  // A standards-compliant MP4 free box exercises the near-limit transport without personal footage.
  const targetSize = 98 * 1024 * 1024;
  assert.ok(original.length < targetSize - 8);
  const padding = Buffer.alloc(targetSize - original.length);
  padding.writeUInt32BE(padding.length);
  padding.write("free", 4);
  const large = Buffer.concat([original, padding]);
  await writeFile("/private/tmp/reelogram-upload-cover.png", fixtures[0].bytes);
  console.log(
    "Isolated localhost:3000 ready; only signed callbacks exposed through temporary tunnel",
  );
  assert.equal((await fetch(callback + "/")).status, 404);
  assert.equal(
    (await fetch(callback + "/api/uploads/process", { method: "POST" })).status,
    404,
  );
  const video = await stage(large, "video", "video/mp4"),
    image = await stage(fixtures[0].bytes, "image", "image/png");
  console.log(
    "98 MiB MP4 and cover staged successfully through application API",
  );
  const input = {
    video,
    image,
    title: "Synthetic upload check",
    description: "Temporary provider integration test",
  };
  const job = await call("/api/uploads/jobs", input);
  assert.equal((await call("/api/uploads/jobs", input)).id, job.id);
  let record;
  for (let i = 0; i < 120; i++) {
    record = await h.db
      .collection("upload_jobs")
      .findOne({ _id: new Types.ObjectId(job.id) });
    if (["published", "failed"].includes(record.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.equal(
    record.status,
    "published",
    record.error || "QStash delivery did not finish",
  );
  assert.equal(await h.db.collection("videos").countDocuments({}), 1);
  const published = await h.db.collection("videos").findOne({});
  assert.equal(String(published._id), job.id);
  assert.equal(
    new URL(published.videoUrl).hostname,
    new URL(process.env.REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT).hostname,
  );
  // Use the player's optimized URL; extensionless originals have different raw-file limits.
  const playback = progressiveVideoUrl(
    published.videoUrl,
    process.env.REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT,
    360,
  );
  let stream;
  for (let attempt = 0; attempt < 12; attempt++) {
    stream = await fetch(playback, {
      headers: { Range: "bytes=0-1023" },
      signal: AbortSignal.timeout(60000),
    });
    if (stream.headers.get("content-type")?.startsWith("video/")) break;
    if (
      stream.status !== 202 &&
      stream.headers.get("is-intermediate-response") !== "true"
    )
      break;
    await stream.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (
    ![200, 206].includes(stream.status) ||
    !stream.headers.get("content-type")?.startsWith("video/")
  ) {
    console.log(
      "ImageKit delivery status:",
      stream.status,
      "content type:",
      stream.headers.get("content-type"),
    );
    console.log(
      "Delivery response:",
      (await stream.text()).slice(0, 350).replace(/https?:\/\/\S+/g, "[URL]"),
    );
    throw Error("Published media delivery failed");
  }
  await stream.body?.cancel();
  console.log(
    "Live QStash signature, R2-to-ImageKit processing, idempotent publication and ImageKit delivery: passed",
  );
  // Verify a real signed empty-body callback and separately validate schedule configuration.
  await qstash.publish({
    url: callback + "/api/uploads/maintenance",
    retries: 3,
    timeout: 55,
  });
  for (let i = 0; i < 30 && !delivered.has("/api/uploads/maintenance"); i++)
    await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.ok(
    delivered.has("/api/uploads/maintenance"),
    "Signed maintenance callback did not succeed",
  );
  scheduleId = `reelogram-upload-test-${_id}`;
  await qstash.schedules.create({
    scheduleId,
    destination: callback + "/api/uploads/maintenance",
    cron: "*/5 * * * *",
    timeout: 55,
    retries: 3,
  });
  await qstash.schedules.delete(scheduleId);
  scheduleId = undefined;
  console.log(
    "Five-minute maintenance schedule configuration accepted; temporary schedule removed",
  );
  if (process.argv.includes("--hold")) {
    console.log(
      "Ready for local browser checks. Stop with SIGINT to remove test assets and database.",
    );
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
} catch (error) {
  console.error(
    "Live upload test failed:",
    error.name,
    String(error.message).replace(/https?:\/\/\S+/g, "[URL]"),
  );
  process.exitCode = 1;
} finally {
  if (scheduleId) await qstash.schedules.delete(scheduleId);
  tunnel?.kill("SIGTERM");
  proxy?.close();
  if (h) {
    await h.stop();
    for (const asset of await h.db
      .collection("upload_assets")
      .find({})
      .toArray()) {
      await removeObject(asset.key, asset.multipartId);
      const fileId = asset.fileId || (await findTransferredAsset(asset));
      if (fileId) await deleteMediaFile(fileId);
    }
    await h.close();
  }
  console.log(
    "Isolated test database, tunnel and uploaded test media cleaned up",
  );
}
