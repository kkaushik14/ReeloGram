import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-opt";
import User, { type InterFUser } from "@/models/User";
import { publicUploader } from "@/lib/public-uploader";
import { limitRequest, rateLimitResponse } from "@/lib/security/rate-limit";
import {
  readAuthJson,
  authFailure,
  AuthRequestError,
} from "@/lib/auth/request";
import { parseMissingDetails } from "@/lib/account/details";
import type { AccountProfile } from "@/lib/account/profile";
import { after } from "next/server";
import { accountAccess } from "@/lib/account/access";
import { requestedParent } from "@/lib/account/parent";
import { createConfirmation } from "@/lib/account/confirmation";
import { validateEmailAddress } from "@/lib/email/address";
import { addressConfirmationEmail } from "@/lib/email/templates";
import { appOrigin, sendEmail } from "@/lib/email/transport";

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
function presentProfile(user: InterFUser): AccountProfile {
  const access = accountAccess(user);
  const name = user.name?.trim() || "";
  const date =
    user.dateOfBirth instanceof Date &&
    Number.isFinite(user.dateOfBirth.getTime())
      ? user.dateOfBirth.toISOString().slice(0, 10)
      : null;
  return {
    name,
    email: user.email,
    dateOfBirth: date,
    image: publicUploader({ _id: user._id, image: user.image }).image || null,
    editable: { name: !name, dateOfBirth: user.dateOfBirth == null },
    emailVerified: access.emailVerified,
    canPublish: access.canPublish,
    parent: {
      required: access.parentRequired,
      email: access.parentRequired ? user.parent?.email || null : null,
      confirmed: access.parentConfirmed,
      ownerConfirmed: !!user.parent?.ownerApprovedAt,
      emailConfirmed: !!user.parent?.verifiedAt,
    },
  };
}
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return Response.json(
        { error: "Please sign in." },
        { status: 401, headers },
      );
    await limitRequest("profileRead", session.user.id, req.headers);
    const user = await User.findById(session.user.id).select(
      "name email image +dateOfBirth +emailVerifiedAt +parent",
    );
    if (!user)
      return Response.json(
        { error: "Account not found." },
        { status: 404, headers },
      );
    return Response.json(presentProfile(user), { headers });
  } catch (error) {
    return (
      rateLimitResponse(error) ??
      Response.json(
        { error: "Your profile is temporarily unavailable." },
        { status: 503, headers },
      )
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return Response.json(
        { error: "Please sign in." },
        { status: 401, headers },
      );
    await limitRequest("profileWrite", session.user.id, req.headers);
    const body = await readAuthJson(req);
    const { parentEmail, parentManaged, ...fields } = body;
    const details = parseMissingDetails(fields);
    if (
      !details.dateOfBirth &&
      (parentEmail !== undefined || parentManaged !== undefined)
    )
      throw new AuthRequestError(
        "Use the parent management section to send a confirmation.",
      );
    const parent = details.dateOfBirth
      ? await requestedParent(
          body,
          details.dateOfBirth,
          session.user.email || "",
        )
      : null;
    if (parent) await validateEmailAddress(session.user.email);
    const ownerConfirmation = parent ? createConfirmation("email") : null;
    if (parent)
      await limitRequest("parentMail", parent.record.email, req.headers);
    // Match the missing fields in the same write that fills them. Concurrent
    // submissions can never overwrite a detail saved by another tab.
    const missing: Record<string, unknown>[] = [];
    if (details.name !== undefined)
      missing.push({ $or: [{ name: null }, { name: /^\s*$/ }] });
    if (details.dateOfBirth !== undefined) missing.push({ dateOfBirth: null });
    const user = await User.findOneAndUpdate(
      { _id: session.user.id, $and: missing },
      {
        $set: {
          ...details,
          ...(parent && ownerConfirmation
            ? {
                parent: parent.record,
                emailConfirmation: {
                  ...ownerConfirmation.stored,
                  parentEmail: parent.record.email,
                },
              }
            : {}),
        },
      },
      { new: true, runValidators: true },
    ).select("name email image +dateOfBirth +emailVerifiedAt +parent");
    if (!user) {
      const exists = await User.exists({ _id: session.user.id });
      return Response.json(
        {
          error: exists
            ? "These details have already been saved and cannot be changed. Your profile has been refreshed."
            : "Account not found.",
        },
        { status: exists ? 409 : 404, headers },
      );
    }
    if (parent && ownerConfirmation)
      after(async () => {
        try {
          await Promise.allSettled([
            sendEmail(
              addressConfirmationEmail(
                parent.record.email,
                `${appOrigin()}/confirm-parent#token=${parent.token}`,
                true,
              ),
              `parent-confirmation:${parent.record.confirmation.digest}`,
            ),
            sendEmail(
              addressConfirmationEmail(
                user.email,
                `${appOrigin()}/verify-email#token=${ownerConfirmation.token}`,
                false,
                parent.record.email,
              ),
              `email-confirmation:${ownerConfirmation.stored.digest}`,
            ),
          ]);
        } catch {
          console.error("Parent confirmation email could not be sent");
        }
      });
    return Response.json(
      {
        profile: presentProfile(user),
        message: "Your details are saved and are now read-only.",
      },
      { headers },
    );
  } catch (error) {
    return authFailure(
      error,
      "Your details couldn’t be saved. Please try again.",
    );
  }
}
