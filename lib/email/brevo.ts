import { createHash } from "node:crypto";
import { parseEmail } from "../auth/validation.ts";
import type { EmailMessage } from "./transport.ts";

export class BrevoQuotaError extends Error {}
export class BrevoUncertainError extends Error {}
export function mailbox(value: string) {
  const match = value.trim().match(/^([^<>]*)\s*<([^<>]+)>$/);
  const email = parseEmail(match ? match[2] : value);
  if (!email || /[\r\n]/.test(value))
    throw Error("Invalid email sender configuration");
  const name = match?.[1].trim().replace(/^"(.*)"$/, "$1");
  return { email, ...(name ? { name } : {}) };
}
export function brevoIdempotencyKey(key: string) {
  const bytes = createHash("sha256").update(key).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function headers() {
  return {
    "api-key": process.env.REELOGRAM_BREVO_API_KEY!,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}
export async function brevoAccount(fetcher = fetch) {
  const response = await fetcher("https://api.brevo.com/v3/account", {
    headers: headers(),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`Brevo account check failed (${response.status})`);
  }
  const account = await response.json();
  if (account.relay?.enabled !== true)
    throw Error("Brevo transactional sending is not activated");
  const plans = Array.isArray(account.plan)
    ? account.plan.filter((plan: { type?: string }) =>
        ["free", "payAsYouGo", "subscription"].includes(plan.type || ""),
      )
    : [];
  const credits = plans.reduce(
    (sum: number, plan: { credits?: number; creditsType?: string }) => {
      if (
        typeof plan.credits !== "number" ||
        !Number.isFinite(plan.credits) ||
        plan.credits < 0
      )
        throw Error("Brevo returned an unknown credit balance");
      return sum + plan.credits;
    },
    0,
  );
  if (!plans.length) throw Error("Brevo email plan could not be verified");
  return Math.floor(credits);
}
export async function sendBrevo(
  message: EmailMessage,
  key: string,
  fetcher = fetch,
) {
  const body = {
    sender: mailbox(
      process.env.REELOGRAM_BREVO_EMAIL_FROM ||
        process.env.REELOGRAM_EMAIL_FROM!,
    ),
    to: [{ email: message.to }],
    subject: message.subject,
    htmlContent: message.html,
    textContent: message.text,
    headers: { idempotencyKey: brevoIdempotencyKey(key) },
    ...(process.env.REELOGRAM_EMAIL_REPLY_TO
      ? { replyTo: mailbox(process.env.REELOGRAM_EMAIL_REPLY_TO) }
      : {}),
  };
  let response: Response;
  try {
    response = await fetcher("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw new BrevoUncertainError(
      "Brevo delivery outcome is unknown; retry with the same provider",
    );
  }
  if (response.ok) {
    await response.body?.cancel();
    return;
  }
  if (response.status >= 500) {
    await response.body?.cancel();
    throw new BrevoUncertainError(
      "Brevo delivery outcome is unknown; retry with the same provider",
    );
  }
  let error;
  try {
    error = await response.json();
  } catch {
    /* Never expose provider response content. */
  }
  if (
    [400, 402, 403].includes(response.status) &&
    error?.code === "not_enough_credits"
  )
    throw new BrevoQuotaError("Brevo email credits exhausted");
  if (
    response.status === 400 &&
    error?.code === "duplicate_parameter" &&
    /idempotenc/i.test(error?.message || "")
  )
    return;
  throw Error(`Brevo delivery rejected (${response.status})`);
}
