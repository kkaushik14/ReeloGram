import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-opt";
import { parseDateOfBirth } from "@/lib/auth/validation";
import {
  readAuthJson,
  authFailure,
  AuthRequestError,
  authHeaders,
} from "@/lib/auth/request";
import { isUnder13 } from "@/lib/account/age";
import { limitRequest } from "@/lib/security/rate-limit";
import User from "@/models/User";

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) throw new AuthRequestError("Please sign in.", 401);
    await limitRequest("profileWrite", session.user.id, req.headers);
    const body = await readAuthJson(req);
    if (
      Object.keys(body).some(
        (key) => !["dateOfBirth", "previousDateOfBirth"].includes(key),
      )
    )
      throw new AuthRequestError("Only the date of birth can be changed here.");
    const date = parseDateOfBirth(body.dateOfBirth);
    const previous = parseDateOfBirth(body.previousDateOfBirth);
    if (!date || !previous)
      throw new AuthRequestError(
        "Enter a valid date of birth, within the last 120 years.",
      );
    if (!isUnder13(previous))
      throw new AuthRequestError(
        "Date of birth cannot be changed here. Refresh your profile.",
        409,
      );
    // Compare the stored date and approval state in the write itself. A stale
    // tab cannot overwrite a correction or remove confirmed parent management.
    const updated = await User.updateOne(
      {
        _id: session.user.id,
        suspended: { $ne: true },
        dateOfBirth: previous,
        $or: [
          { "parent.verifiedAt": null },
          { "parent.ownerApprovedAt": null },
        ],
      },
      {
        $set: { dateOfBirth: date },
        // Revoke outstanding parent-bound links when they no longer apply.
        ...(!isUnder13(date)
          ? { $unset: { parent: 1, emailConfirmation: 1 } }
          : {}),
      },
      { runValidators: true },
    );
    if (!updated.matchedCount)
      throw new AuthRequestError(
        "Your details or confirmation status have changed. Refresh your profile.",
        409,
      );
    return Response.json(
      { message: "Your date of birth has been updated." },
      { headers: authHeaders },
    );
  } catch (error) {
    return authFailure(
      error,
      "Your date of birth couldn’t be updated. Please try again.",
    );
  }
}
