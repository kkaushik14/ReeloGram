import { createHash } from "node:crypto";
import { appOrigin, type EmailMessage } from "./transport.ts";
export function smtpConfigured() {
  return !!(
    process.env.REELOGRAM_SMTP_HOST &&
    process.env.REELOGRAM_SMTP_USER &&
    process.env.REELOGRAM_SMTP_PASSWORD &&
    process.env.REELOGRAM_EMAIL_FROM
  );
}
export async function sendSmtp(message: EmailMessage, idempotencyKey: string) {
  if (!smtpConfigured()) throw Error("SMTP fallback is not configured");
  const { default: nodemailer } = await import("nodemailer");
  const port = Number(process.env.REELOGRAM_SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.REELOGRAM_SMTP_HOST,
    port,
    secure: process.env.REELOGRAM_SMTP_SECURE === "1" || port === 465,
    requireTLS: !(process.env.REELOGRAM_SMTP_SECURE === "1" || port === 465),
    auth: {
      user: process.env.REELOGRAM_SMTP_USER,
      pass: process.env.REELOGRAM_SMTP_PASSWORD,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  try {
    await transporter.sendMail({
      ...message,
      from: process.env.REELOGRAM_EMAIL_FROM,
      replyTo: process.env.REELOGRAM_EMAIL_REPLY_TO,
      messageId: `<${createHash("sha256").update(idempotencyKey).digest("hex")}@${new URL(appOrigin()).hostname}>`,
    });
  } finally {
    transporter.close();
  }
}
