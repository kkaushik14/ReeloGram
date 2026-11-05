import { createHash } from "node:crypto";
import EmailJob from "../../models/EmailJob.ts";
import { sendEmail, emailConfigured, type EmailMessage } from "./transport.ts";
/** Call only after the main operation has succeeded. Event keys prevent duplicate notices. */
export async function queueEmail(message: EmailMessage, eventKey: string) {
  const id = createHash("sha256").update(eventKey).digest("hex");
  await EmailJob.updateOne(
    { _id: id },
    {
      $setOnInsert: {
        ...message,
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    },
    { upsert: true },
  );
  return id;
}
export async function deliverQueuedEmails(id?: string) {
  if (!emailConfigured()) return;
  await EmailJob.init();
  for (let index = 0; index < (id ? 1 : 20); index++) {
    const now = new Date();
    const job = await EmailJob.findOneAndUpdate(
      {
        ...(id ? { _id: id } : {}),
        expiresAt: { $gt: now },
        attempts: { $lt: 5 },
        $or: [
          { status: "pending", nextAttemptAt: { $lte: now } },
          { status: "sending", leaseUntil: { $lt: now } },
        ],
      },
      {
        $set: { status: "sending", leaseUntil: new Date(Date.now() + 60000) },
        $inc: { attempts: 1 },
      },
      { new: true },
    );
    if (!job) return;
    try {
      await sendEmail(
        { to: job.to, subject: job.subject, html: job.html, text: job.text },
        job.id,
      );
      // Remove the payload after success; keep only deduplication metadata until expiry.
      await EmailJob.updateOne(
        { _id: job.id, status: "sending" },
        {
          $set: { status: "sent", sentAt: new Date() },
          $unset: { html: 1, text: 1, to: 1, subject: 1, leaseUntil: 1 },
        },
      );
    } catch {
      await EmailJob.updateOne(
        { _id: job.id, status: "sending" },
        {
          $set: {
            status: job.attempts >= 5 ? "failed" : "pending",
            nextAttemptAt: new Date(
              Date.now() + Math.min(3600, 30 * 2 ** job.attempts) * 1000,
            ),
          },
          $unset: { leaseUntil: 1 },
        },
      );
      console.error("Transactional email queued for retry");
    }
    if (!id) await new Promise((resolve) => setTimeout(resolve, 600));
  }
}
