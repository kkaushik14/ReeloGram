// Opt-in live smoke test. Uses only uniquely named test assets, never account/feed data.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fixtures } from "./e2e-fixtures.mjs";
import * as storage from "../lib/uploads/staging/storage.ts";
import {
  transferAsset,
  findTransferredAsset,
} from "../lib/uploads/staging/imagekit.ts";
import { deleteMediaFile } from "../lib/video-media.ts";
import { Client } from "@upstash/qstash";
import { queueConfig } from "../lib/uploads/staging/queue.ts";

if (!process.argv.includes("--live"))
  throw Error(
    "Pass --live to test configured services and clean up the test files.",
  );
const run = randomUUID();
const origins = [
  "http://localhost:3000",
  ...(process.env.UPLOAD_TEST_ORIGINS || "").split(",").filter(Boolean),
];
const created = [];
let fileId, asset, messageId, queue;
try {
  queue = new Client(queueConfig());
  await queue.schedules.list();
  console.log("QStash credentials and regional endpoint: passed");
  // Delay and immediately delete: validate plan constraints without delivering a request.
  const destination = process.env.UPLOAD_TEST_CALLBACK_ORIGIN;
  if (destination) {
    const message = await queue.publishJSON({
      url: `${new URL(destination).origin}/api/uploads/process`,
      body: { id: "0".repeat(24) },
      delay: 3600,
      retries: 12,
      timeout: 55,
      flowControl: { key: "reelogram-uploads-test", parallelism: 2 },
    });
    messageId = message.messageId;
    await queue.messages.delete(messageId);
    messageId = undefined;
    console.log(
      "QStash delivery configuration accepted; scheduled test message cancelled",
    );
  }
  for (const fixture of [
    {
      bytes: randomBytes(9 * 1024 * 1024),
      type: "application/octet-stream",
      name: "parts",
    },
    fixtures[0],
  ]) {
    const key = `drafts/provider-test-${run}/${fixture.name}`;
    const uploadId = await storage.startMultipart(key, fixture.type);
    created.push({ key, uploadId });
    const count = Math.ceil(fixture.bytes.length / (8 * 1024 * 1024));
    const signed = await storage.partUrls(
      key,
      uploadId,
      fixture.bytes.length,
      Array.from({ length: count }, (_, i) => i + 1),
    );
    for (const origin of origins) {
      const preflight = await fetch(signed[0].url, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "content-type",
        },
      });
      assert.equal(
        preflight.headers.get("access-control-allow-origin"),
        origin,
      );
    }
    const denied = await fetch(signed[0].url, {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.invalid",
        "Access-Control-Request-Method": "PUT",
      },
    });
    assert.notEqual(
      denied.headers.get("access-control-allow-origin"),
      "https://attacker.invalid",
    );
    for (const part of signed) {
      const start = (part.part - 1) * 8 * 1024 * 1024;
      const response = await fetch(part.url, {
        method: "PUT",
        body: fixture.bytes.subarray(start, start + 8 * 1024 * 1024),
        headers: { "Content-Type": fixture.type, Origin: origins[0] },
        signal: AbortSignal.timeout(120000),
      });
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("etag"));
    }
    const parts = await storage.listParts(key, uploadId);
    assert.equal(parts.length, count);
    await storage.completeMultipart(key, uploadId, parts);
    assert.equal((await storage.inspectObject(key)).size, fixture.bytes.length);
    const signedGet = await storage.objectUrl(key);
    const publicGet = new URL(signedGet);
    publicGet.search = "";
    assert.equal((await fetch(publicGet)).ok, false);
    const download = await fetch(signedGet);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), fixture.bytes);
    console.log(
      `R2 ${count}-part transfer, exact bytes, CORS and private access: passed`,
    );
    if (fixture.type === "image/png") {
      asset = {
        key,
        folder: `/reelogram-provider-tests/${run}`,
        fileName: "smoke.png",
        mime: fixture.type,
        size: fixture.bytes.length,
      };
      fileId = await transferAsset(asset);
      assert.equal(await findTransferredAsset(asset), fileId);
      assert.equal(await transferAsset(asset), fileId);
      console.log(
        "ImageKit signed R2 import and duplicate reconciliation: passed",
      );
    }
  }
} catch (error) {
  // No SDK request dumps, signed URLs, headers or credentials in test output.
  console.error(
    "Provider smoke test failed:",
    error.name,
    String(error.message).replace(/https?:\/\/\S+/g, "[URL]"),
  );
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([
    ...(messageId ? [queue.messages.delete(messageId)] : []),
    (async () => {
      if (!fileId && asset) fileId = await findTransferredAsset(asset);
      if (fileId) await deleteMediaFile(fileId);
    })(),
    ...created.map((item) => storage.removeObject(item.key, item.uploadId)),
  ]);
  if (cleanup.some((result) => result.status === "rejected")) {
    console.error("Cleanup needs retry for provider test run:", run);
    process.exitCode = 1;
  } else console.log("Temporary provider test assets cleaned up");
}
