import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { startEmailTestServer } from "./email-test-server.mjs";

if (!process.env.REELOGRAM_BREVO_TEST_WORKER) {
  const smtp = await startEmailTestServer();
  const db = await MongoMemoryServer.create();
  try {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", import.meta.filename],
      {
        env: {
          ...process.env,
          ...smtp.env,
          REELOGRAM_EMAIL_PROVIDER: "brevo",
          REELOGRAM_BREVO_API_KEY: "isolated-test-key",
          REELOGRAM_BREVO_DAILY_LIMIT: "3",
          REELOGRAM_MONGODB_URL: db.getUri(),
          REELOGRAM_APP_URL: "http://127.0.0.1:3000",
          REELOGRAM_BREVO_TEST_WORKER: "1",
        },
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      },
    );
    child.on("message", (message) => {
      if (message === "count") child.send(smtp.messages.length);
      if (message === "fail-next") {
        smtp.failNext();
        child.send("ready");
      }
    });
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    console.log(
      `PASS: Brevo routing and ${smtp.messages.length} deliveries to the isolated TLS SMTP fallback.`,
    );
  } finally {
    await db.stop();
    await smtp.stop();
  }
} else {
  const { sendEmail } = await import("../lib/email/transport.ts");
  const { createDeliveryStore } = await import(
    "../lib/email/delivery-store.ts"
  );
  const { sendWithBrevoFallback } = await import(
    "../lib/email/brevo-delivery.ts"
  );
  const { sendBrevo } = await import("../lib/email/brevo.ts");
  const { sendSmtp } = await import("../lib/email/smtp.ts");
  const originalFetch = globalThis.fetch;
  let mode = "success",
    sends = 0,
    reads = 0,
    balance = 300;
  globalThis.fetch = async (url) => {
    if (url === "https://api.brevo.com/v3/account") {
      reads++;
      return Response.json({
        relay: { enabled: true },
        plan: [{ type: "free", credits: balance, creditsType: "sendLimit" }],
      });
    }
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    sends++;
    if (mode === "timeout") throw Error("unknown network result");
    if (mode === "quota")
      return Response.json({ code: "not_enough_credits" }, { status: 400 });
    if (mode === "auth")
      return Response.json({ code: "unauthorized" }, { status: 401 });
    if (mode === "throttle")
      return Response.json({ code: "too_many_requests" }, { status: 429 });
    return Response.json({ messageId: "isolated" }, { status: 201 });
  };
  const message = {
    to: "fixture@example.invalid",
    subject: "Routing test",
    html: "<p>Test</p>",
    text: "Test",
  };
  const count = async () => {
    const reply = once(process, "message");
    process.send("count");
    return (await reply)[0];
  };
  try {
    await mongoose.connect(process.env.REELOGRAM_MONGODB_URL);
    const deliveries = mongoose.connection.collection("email_deliveries"),
      quotas = mongoose.connection.collection("email_quotas");
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        sendEmail(message, `concurrent-${i}`),
      ),
    );
    assert.equal(sends, 3);
    assert.equal(await count(), 9);
    assert.equal(reads, 1);
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        sendEmail(message, `concurrent-${i}`),
      ),
    );
    assert.equal(sends, 3);
    assert.equal(
      await count(),
      9,
      "Completed deliveries deduplicate across retries",
    );
    let now = Date.now() + 86400001;
    const store = createDeliveryStore(deliveries, quotas, () => new Date(now));
    const deps = { store: async () => store, brevo: sendBrevo, smtp: sendSmtp };
    await sendWithBrevoFallback(message, "next-day", deps);
    assert.equal(sends, 4);
    assert.equal(
      reads,
      2,
      "Credits refresh and Brevo resumes without redeployment",
    );
    mode = "quota";
    await sendWithBrevoFallback(message, "explicit-quota", deps);
    assert.equal(await count(), 10);
    await sendWithBrevoFallback(message, "explicit-quota", deps);
    assert.equal(await count(), 10);
    now += 120001;
    mode = "timeout";
    await assert.rejects(
      sendWithBrevoFallback(message, "uncertain", deps),
      /unknown/,
    );
    assert.equal(await count(), 10, "Timeout must never fall back to SMTP");
    now += 86400001;
    mode = "success";
    await sendWithBrevoFallback(message, "uncertain", deps);
    assert.equal(
      await count(),
      10,
      "Retry stays on Brevo even after quota window changes",
    );
    mode = "auth";
    await assert.rejects(
      sendWithBrevoFallback(message, "auth-error", deps),
      /401/,
    );
    mode = "throttle";
    await assert.rejects(
      sendWithBrevoFallback(message, "rate-error", deps),
      /429/,
    );
    assert.equal(
      await count(),
      10,
      "Authentication errors and API throttling are not exhausted credits",
    );
    now += 86400001;
    balance = 0;
    mode = "success";
    const before = sends;
    await sendWithBrevoFallback(message, "no-credits", deps);
    assert.equal(sends, before);
    assert.equal(await count(), 11);
    // Fallback failures remain pinned to SMTP on retry, even after credits return.
    const ready = once(process, "message");
    process.send("fail-next");
    await ready;
    await assert.rejects(sendWithBrevoFallback(message, "smtp-retry", deps));
    now += 86400001;
    balance = 300;
    await sendWithBrevoFallback(message, "smtp-retry", deps);
    assert.equal(sends, before);
    assert.equal(await count(), 12);
    // Lease recovery is bounded and previous workers cannot change the new lease.
    const lease = await store.claim("lease-case");
    await assert.rejects(store.claim("lease-case"), /in progress/);
    now += 60001;
    const reclaimed = await store.claim("lease-case");
    await assert.rejects(store.route(lease, "smtp"), /lease expired/);
    await store.route(reclaimed, "smtp");
    await store.finish(reclaimed);
    assert.equal(await store.claim("lease-case"), null);
    const interrupted = await store.claim("interrupted-send");
    await store.route(interrupted, "brevo");
    await store.beginAttempt(interrupted);
    now += 60001;
    const recovered = await store.claim("interrupted-send");
    assert.ok(
      recovered.uncertainAt,
      "A process crash after submission is an uncertain outcome",
    );
    await store.release(recovered);
    await deliveries.updateOne(
      { _id: recovered._id },
      { $set: { uncertainAt: new Date(Date.now() - 15 * 60000) } },
    );
    const beforeReview = sends;
    await assert.rejects(
      sendWithBrevoFallback(message, "interrupted-send", deps),
      /requires review/,
    );
    assert.equal(sends, beforeReview);
    assert.equal(
      await count(),
      12,
      "Expired uncertain sends cannot switch providers",
    );
    console.log(
      "PASS: shared quota, cold-start concurrency, reset, sticky fallback, idempotency, unknown outcomes, provider errors and leases.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await mongoose.disconnect();
    process.disconnect();
  }
}
