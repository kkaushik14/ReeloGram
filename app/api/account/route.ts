import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-opt";
import User, { type InterFUser } from "@/models/User";
import { publicUploader } from "@/lib/public-uploader";
import { limitRequest, rateLimitResponse } from "@/lib/security/rate-limit";
import { readAuthJson, authFailure } from "@/lib/auth/request";
import { parseMissingDetails } from "@/lib/account/details";
import type { AccountProfile } from "@/lib/account/profile";

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
function presentProfile(user: InterFUser): AccountProfile {
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
      "name email image +dateOfBirth",
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
    const details = parseMissingDetails(await readAuthJson(req));
    // Match the missing fields in the same write that fills them. Concurrent
    // submissions can never overwrite a detail saved by another tab.
    const missing: Record<string, unknown>[] = [];
    if (details.name !== undefined)
      missing.push({ $or: [{ name: null }, { name: /^\s*$/ }] });
    if (details.dateOfBirth !== undefined) missing.push({ dateOfBirth: null });
    const user = await User.findOneAndUpdate(
      { _id: session.user.id, $and: missing },
      { $set: details },
      { new: true, runValidators: true },
    ).select("name email image +dateOfBirth");
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
