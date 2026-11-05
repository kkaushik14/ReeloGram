import User from "../../models/User.ts";
import { isUnder13 } from "../account/age.ts";
import { queueEmail, deliverQueuedEmails } from "./outbox.ts";
import { sendEmail, type EmailMessage } from "./transport.ts";

async function recipients(userId: string, primary: string) {
  const user = await User.findById(userId).select(
    "email +dateOfBirth +parent +emailVerifiedAt",
  );
  const parent =
    user &&
    user.emailVerifiedAt &&
    isUnder13(user.dateOfBirth) &&
    user.parent?.verifiedAt &&
    user.parent?.ownerApprovedAt
      ? user.parent.email
      : null;
  return [
    ...new Set([primary, ...(parent && parent !== primary ? [parent] : [])]),
  ];
}
/** Only confirmed parents receive account copies. Address-confirmation links never use this helper. */
export async function queueAccountEmail(
  userId: string,
  message: EmailMessage,
  eventKey: string,
) {
  const targets = await recipients(userId, message.to);
  for (const [index, to] of targets.entries()) {
    const id = await queueEmail(
      {
        ...message,
        to,
        ...(index ? { subject: `Parent copy: ${message.subject}` } : {}),
      },
      `${eventKey}:${index}`,
    );
    await deliverQueuedEmails(id);
  }
}
export async function sendAccountEmail(
  userId: string,
  message: EmailMessage,
  eventKey: string,
) {
  const targets = await recipients(userId, message.to);
  const result = await Promise.allSettled(
    targets.map((to, index) =>
      sendEmail(
        {
          ...message,
          to,
          ...(index ? { subject: `Parent copy: ${message.subject}` } : {}),
        },
        `${eventKey}:${index}`,
      ),
    ),
  );
  if (!result.some((item) => item.status === "fulfilled"))
    throw Error("Account email delivery failed");
}
