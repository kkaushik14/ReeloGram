import { createHash } from "node:crypto";
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};
export class EmailConfigurationError extends Error {}
export function appOrigin() {
  const value = process.env.APP_URL || process.env.NEXTAUTH_URL;
  if (!value) throw new EmailConfigurationError("Set APP_URL or NEXTAUTH_URL");
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new EmailConfigurationError("Use HTTPS for public email links");
  return url.origin;
}
export function emailConfigured() {
  return (
    !!process.env.EMAIL_FROM &&
    (process.env.EMAIL_PROVIDER === "smtp"
      ? !!process.env.SMTP_HOST &&
        !!process.env.SMTP_USER &&
        !!process.env.SMTP_PASSWORD
      : !!process.env.RESEND_API_KEY)
  );
}
export async function sendEmail(message: EmailMessage, idempotencyKey: string) {
  if (!emailConfigured())
    throw new EmailConfigurationError("Email sender is not configured");
  if (/[\r\n]/.test(message.to + message.subject + process.env.EMAIL_FROM))
    throw Error("Invalid email headers");
  if (process.env.EMAIL_PROVIDER === "smtp") {
    const { default: nodemailer } = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === "1" || port === 465,
      requireTLS: !(process.env.SMTP_SECURE === "1" || port === 465),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    try {
      await transporter.sendMail({
        ...message,
        from: process.env.EMAIL_FROM,
        replyTo: process.env.EMAIL_REPLY_TO,
        messageId: `<${createHash("sha256").update(idempotencyKey).digest("hex")}@${new URL(appOrigin()).hostname}>`,
      });
    } finally {
      transporter.close();
    }
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      ...message,
      to: [message.to],
      from: process.env.EMAIL_FROM,
      ...(process.env.EMAIL_REPLY_TO
        ? { reply_to: process.env.EMAIL_REPLY_TO }
        : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  // Never log provider responses; they may contain recipients or request data.
  await response.body?.cancel();
  if (!response.ok)
    throw new Error(`Email delivery failed (${response.status})`);
}
