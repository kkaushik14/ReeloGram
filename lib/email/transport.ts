import { smtpConfigured, sendSmtp } from "./smtp.ts";
import { sendWithBrevoFallback } from "./brevo-delivery.ts";
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};
export class EmailConfigurationError extends Error {}
export function appOrigin() {
  const value =
    process.env.REELOGRAM_APP_URL || process.env.REELOGRAM_NEXTAUTH_URL;
  if (!value)
    throw new EmailConfigurationError(
      "Set REELOGRAM_APP_URL or REELOGRAM_NEXTAUTH_URL",
    );
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
  if (!process.env.REELOGRAM_EMAIL_FROM) return false;
  switch (process.env.REELOGRAM_EMAIL_PROVIDER || "resend") {
    case "smtp":
      return smtpConfigured();
    case "brevo":
      return !!process.env.REELOGRAM_BREVO_API_KEY && smtpConfigured();
    case "resend":
      return !!process.env.REELOGRAM_RESEND_API_KEY;
    default:
      return false;
  }
}
export async function sendEmail(message: EmailMessage, idempotencyKey: string) {
  if (!emailConfigured())
    throw new EmailConfigurationError("Email sender is not configured");
  if (
    /[\r\n]/.test(
      message.to +
        message.subject +
        process.env.REELOGRAM_EMAIL_FROM +
        (process.env.REELOGRAM_EMAIL_REPLY_TO || "") +
        (process.env.REELOGRAM_BREVO_EMAIL_FROM || ""),
    )
  )
    throw Error("Invalid email headers");
  if (process.env.REELOGRAM_EMAIL_PROVIDER === "smtp")
    return sendSmtp(message, idempotencyKey);
  if (process.env.REELOGRAM_EMAIL_PROVIDER === "brevo")
    return sendWithBrevoFallback(message, idempotencyKey);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.REELOGRAM_RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      ...message,
      to: [message.to],
      from: process.env.REELOGRAM_EMAIL_FROM,
      ...(process.env.REELOGRAM_EMAIL_REPLY_TO
        ? { reply_to: process.env.REELOGRAM_EMAIL_REPLY_TO }
        : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  // Never log provider responses; they may contain recipients or request data.
  await response.body?.cancel();
  if (!response.ok)
    throw new Error(`Email delivery failed (${response.status})`);
}
