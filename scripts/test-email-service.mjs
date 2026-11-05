import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startEmailTestServer } from "./email-test-server.mjs";
// A child process loads the test CA before Node initializes TLS trust.
if (!process.env.REELOGRAM_EMAIL_TEST_WORKER) {
  const mail = await startEmailTestServer();
  const db = await MongoMemoryServer.create({
    instance: { dbName: "reelogram_email" },
    binary: { downloadDir: join(tmpdir(), "reelogram-mongodb-binaries") },
  });
  try {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", import.meta.filename],
      {
        env: {
          ...process.env,
          ...mail.env,
          REELOGRAM_EMAIL_TEST_WORKER: "1",
          REELOGRAM_MONGODB_URL: db.getUri(),
          REELOGRAM_APP_URL: "http://127.0.0.1:3000",
        },
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      },
    );
    child.on("message", (message) => {
      if (message === "fail-next") mail.failNext();
      if (message === "count") child.send(mail.messages.length);
    });
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    assert.equal(mail.messages.length, 2);
    console.log(
      "PASS: SMTP queue deduplication, failures/retry, leases, payload cleanup and expiry.",
    );
  } finally {
    await db.stop();
    await mail.stop();
  }
} else {
  const { queueEmail, deliverQueuedEmails } =
    await import("../lib/email/outbox.ts");
  const { default: EmailJob } = await import("../models/EmailJob.ts");
  try {
    await mongoose.connect(process.env.REELOGRAM_MONGODB_URL);
    await EmailJob.init();
    const message = {
      to: "account@example.invalid",
      subject: "Queue check",
      html: "<p>A message</p>",
      text: "A message",
    };
    const ids = await Promise.all(
      [1, 2].map(() => queueEmail(message, "same-event")),
    );
    assert.equal(ids[0], ids[1]);
    assert.equal(await EmailJob.countDocuments(), 1);
    await Promise.all([
      deliverQueuedEmails(ids[0]),
      deliverQueuedEmails(ids[0]),
    ]);
    const sent = await EmailJob.findById(ids[0]);
    assert.equal(sent.status, "sent");
    assert.equal(sent.attempts, 1);
    assert.equal(sent.html, undefined);
    assert.equal(sent.to, undefined);
    process.send("fail-next");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const retry = await queueEmail(message, "retry-event");
    await deliverQueuedEmails(retry);
    let job = await EmailJob.findById(retry);
    assert.equal(job.status, "pending");
    assert.equal(job.attempts, 1);
    assert.ok(job.nextAttemptAt > Date.now());
    await EmailJob.updateOne(
      { _id: retry },
      { $set: { nextAttemptAt: new Date(0) } },
    );
    await deliverQueuedEmails(retry);
    job = await EmailJob.findById(retry);
    assert.equal(job.status, "sent");
    assert.equal(job.attempts, 2);
    const expired = await queueEmail(message, "expired-event");
    await EmailJob.updateOne(
      { _id: expired },
      { $set: { expiresAt: new Date(0) } },
    );
    await deliverQueuedEmails(expired);
    assert.equal((await EmailJob.findById(expired)).attempts, 0);
  } catch (error) {
    console.error("Email test failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    process.disconnect();
  }
}
