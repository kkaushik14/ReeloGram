import { after } from "next/server";
import {
  readAuthJson,
  authFailure,
  AuthRequestError,
  authHeaders,
} from "@/lib/auth/request";
import {
  confirmationDigest,
  validConfirmationToken,
} from "@/lib/account/confirmation";
import { isUnder13 } from "@/lib/account/age";
import { accountAccess } from "@/lib/account/access";
import { limitRequest } from "@/lib/security/rate-limit";
import { queueAccountEmail } from "@/lib/email/account";
import { accountCreatedEmail } from "@/lib/email/templates";
import { appOrigin } from "@/lib/email/transport";
import User from "@/models/User";
export async function POST(req: Request) {
  try {
    const body = await readAuthJson(req);
    if (
      !validConfirmationToken(body.token) ||
      !["email", "parent"].includes(String(body.kind))
    )
      throw new AuthRequestError(
        "This confirmation link is invalid or expired. Request a new one from Profile.",
      );
    const kind = body.kind as "email" | "parent";
    if (kind === "parent" && body.accepted !== true)
      throw new AuthRequestError(
        "Confirm that you are the parent or guardian and agree to manage this account.",
      );
    const digest = confirmationDigest(kind, body.token);
    await limitRequest("confirmation", digest, req.headers);
    const field =
      kind === "email" ? "emailConfirmation" : "parent.confirmation";
    const filter: Record<string, unknown> = {
      [`${field}.digest`]: digest,
      [`${field}.expiresAt`]: { $gt: new Date() },
    };
    const pending = await User.findOne(filter).select(
      "+dateOfBirth +emailConfirmation +parent",
    );
    if (!pending)
      throw new AuthRequestError(
        "This confirmation link has already been used or has expired. Request a new one from Profile.",
      );
    if (kind === "parent" && !isUnder13(pending.dateOfBirth))
      throw new AuthRequestError(
        "Parent confirmation is no longer needed for this account.",
      );
    const changes: Record<string, Date> = {
      [kind === "email" ? "emailVerifiedAt" : "parent.verifiedAt"]: new Date(),
    };
    const parentEmail =
      kind === "email" && isUnder13(pending.dateOfBirth)
        ? pending.emailConfirmation?.parentEmail
        : null;
    if (parentEmail) {
      if (pending.parent?.email !== parentEmail)
        throw new AuthRequestError(
          "The parent address has changed. Request a new confirmation from Profile.",
        );
      filter["parent.email"] = parentEmail;
      changes["parent.ownerApprovedAt"] = new Date();
    }
    const user = await User.findOneAndUpdate(
      filter,
      { $set: changes, $unset: { [field]: 1 } },
      { new: true },
    ).select("email name +dateOfBirth +emailVerifiedAt +parent");
    if (!user)
      throw new AuthRequestError(
        "This confirmation link has already been used or has expired. Request a new one from Profile.",
      );
    const access = accountAccess(user);
    if (access.parentConfirmed)
      after(async () => {
        try {
          await queueAccountEmail(
            String(user._id),
            accountCreatedEmail(user.email, user.name || "there", appOrigin()),
            `parent-confirmed:${user.id}`,
          );
        } catch {
          console.error("Parent confirmation notice could not be queued");
        }
      });
    return Response.json(
      {
        managementActive: access.parentConfirmed,
        message:
          kind === "parent"
            ? access.parentConfirmed
              ? "Parent management is confirmed. Account emails and password-reset links will also be sent to the confirmed parent."
              : "The parent email is confirmed. The account’s own email must also approve the parent address before management starts."
            : "Your email is confirmed. You can return to your profile.",
      },
      { headers: authHeaders },
    );
  } catch (error) {
    return authFailure(error);
  }
}
