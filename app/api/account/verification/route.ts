import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-opt";
import {
  readAuthJson,
  authFailure,
  AuthRequestError,
  authHeaders,
} from "@/lib/auth/request";
import { limitRequest } from "@/lib/security/rate-limit";
import { validateEmailAddress } from "@/lib/email/address";
import { createConfirmation } from "@/lib/account/confirmation";
import { requestedParent } from "@/lib/account/parent";
import { isUnder13 } from "@/lib/account/age";
import { addressConfirmationEmail } from "@/lib/email/templates";
import { appOrigin, sendEmail } from "@/lib/email/transport";
import User from "@/models/User";
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return Response.json(
        { error: "Please sign in." },
        { status: 401, headers: authHeaders },
      );
    const body = await readAuthJson(req);
    await limitRequest("verification", session.user.id, req.headers);
    const user = await User.findById(session.user.id).select(
      "email +emailVerifiedAt +dateOfBirth +parent",
    );
    if (!user) throw new AuthRequestError("Account not found.", 404);
    if (body.kind === "email") {
      const parentEmail =
        isUnder13(user.dateOfBirth) &&
        user.parent?.email &&
        !user.parent?.ownerApprovedAt
          ? user.parent.email
          : null;
      if (user.emailVerifiedAt && !parentEmail)
        return Response.json(
          { message: "Your email is already confirmed." },
          { headers: authHeaders },
        );
      await validateEmailAddress(user.email);
      const confirmation = createConfirmation("email");
      const updated = await User.updateOne(
        {
          _id: user._id,
          ...(parentEmail
            ? { "parent.email": parentEmail, "parent.ownerApprovedAt": null }
            : { emailVerifiedAt: null }),
        },
        {
          $set: {
            emailConfirmation: {
              ...confirmation.stored,
              ...(parentEmail ? { parentEmail } : {}),
            },
          },
        },
      );
      if (!updated.matchedCount)
        throw new AuthRequestError(
          "Your confirmation status has changed. Refresh your profile.",
          409,
        );
      await sendEmail(
        addressConfirmationEmail(
          user.email,
          `${appOrigin()}/verify-email#token=${confirmation.token}`,
          false,
          parentEmail || undefined,
        ),
        `email-confirmation:${confirmation.stored.digest}`,
      );
    } else if (body.kind === "parent") {
      if (user.parent?.verifiedAt && user.parent?.ownerApprovedAt)
        throw new AuthRequestError(
          "Parent management is already confirmed and cannot be changed here.",
          409,
        );
      const parent = await requestedParent(body, user.dateOfBirth, user.email);
      if (!parent)
        throw new AuthRequestError(
          "Parent management is not required for this account.",
        );
      await limitRequest("parentMail", parent.record.email, req.headers);
      const preserveApproval =
        parent.record.email === user.parent?.email &&
        !!user.parent?.ownerApprovedAt;
      const confirmation = preserveApproval
        ? null
        : createConfirmation("email");
      if (confirmation) await validateEmailAddress(user.email);
      const updated = await User.updateOne(
        {
          _id: user._id,
          $or: [
            { "parent.verifiedAt": null },
            { "parent.ownerApprovedAt": null },
          ],
        },
        {
          $set: {
            parent: {
              ...parent.record,
              ...(preserveApproval
                ? { ownerApprovedAt: user.parent.ownerApprovedAt }
                : {}),
            },
            ...(confirmation
              ? {
                  emailConfirmation: {
                    ...confirmation.stored,
                    parentEmail: parent.record.email,
                  },
                }
              : {}),
          },
        },
      );
      if (!updated.matchedCount)
        throw new AuthRequestError(
          "Parent management has already been confirmed. Refresh your profile.",
          409,
        );
      await Promise.all([
        sendEmail(
          addressConfirmationEmail(
            parent.record.email,
            `${appOrigin()}/confirm-parent#token=${parent.token}`,
            true,
          ),
          `parent-confirmation:${parent.record.confirmation.digest}`,
        ),
        ...(confirmation
          ? [
              sendEmail(
                addressConfirmationEmail(
                  user.email,
                  `${appOrigin()}/verify-email#token=${confirmation.token}`,
                  false,
                  parent.record.email,
                ),
                `email-confirmation:${confirmation.stored.digest}`,
              ),
            ]
          : []),
      ]);
    } else throw new AuthRequestError("Choose email or parent confirmation.");
    return Response.json(
      {
        message:
          "Confirmation email sent. Check the inbox and spam folder. The link works for 24 hours.",
      },
      { headers: authHeaders },
    );
  } catch (error) {
    return authFailure(
      error,
      "We couldn’t send the confirmation email. Please try again later.",
    );
  }
}
