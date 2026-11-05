import { deliveryStore } from "./delivery-store.ts";
import { BrevoQuotaError, BrevoUncertainError, sendBrevo } from "./brevo.ts";
import { sendSmtp } from "./smtp.ts";
import type { EmailMessage } from "./transport.ts";

export function brevoLimit() {
  const limit = Number(process.env.REELOGRAM_BREVO_DAILY_LIMIT || 300);
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 300)
    throw Error("REELOGRAM_BREVO_DAILY_LIMIT must be between 0 and 300");
  return limit;
}
export async function sendWithBrevoFallback(
  message: EmailMessage,
  key: string,
  dependencies = { store: deliveryStore, brevo: sendBrevo, smtp: sendSmtp },
) {
  const limit = brevoLimit();
  const store = await dependencies.store();
  const delivery = await store.claim(key);
  if (!delivery) return;
  try {
    if (!delivery.provider) {
      const available = limit > 0 && (await store.reserve(delivery._id, limit));
      await store.route(delivery, available ? "brevo" : "smtp");
    }
    if (delivery.provider === "brevo") {
      // Brevo's idempotency window is finite. Never route an uncertain delivery
      // to SMTP or blindly resend it after that window has expired.
      if (
        delivery.uncertainAt &&
        Date.now() - +delivery.uncertainAt >= 14 * 60000
      )
        throw Error(
          "Uncertain Brevo delivery requires review before resending",
        );
      try {
        await store.beginAttempt(delivery);
        await dependencies.brevo(message, key);
      } catch (error) {
        if (!(error instanceof BrevoQuotaError) || delivery.uncertainAt)
          throw error;
        await store.exhausted();
        await store.route(delivery, "smtp");
        await dependencies.smtp(message, key);
      }
    } else {
      await dependencies.smtp(message, key);
    }
    await store.finish(delivery);
  } catch (error) {
    await store.release(delivery, error instanceof BrevoUncertainError);
    throw error;
  }
}
