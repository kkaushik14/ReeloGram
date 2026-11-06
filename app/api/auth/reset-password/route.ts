import { after, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { passwordError, validResetToken } from "@/lib/auth/validation";
import {
  readAuthJson,
  authFailure,
  authHeaders,
  AuthRequestError,
} from "@/lib/auth/request";
import { limitAuth } from "@/lib/auth/rate-limit";
import { queueAccountEmail } from "@/lib/email/account";
import { passwordChangedEmail } from "@/lib/email/templates";
import { createSignInGrant } from "@/lib/auth/sign-in-grant";
import User from "@/models/User";
export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);
    if (!validResetToken(body.token))
      throw new AuthRequestError(
        "This reset link is invalid or has expired. Request a new link.",
      );
    const problem = passwordError(body.password);
    if (problem) throw new AuthRequestError(problem);
    const digest = createHash("sha256").update(body.token).digest("hex");
    await limitAuth("reset", digest, request.headers);
    const user = await User.findOne({
      suspended: { $ne: true },
      "passwordReset.digest": digest,
      "passwordReset.expiresAt": { $gt: new Date() },
    }).select("password");
    if (!user)
      throw new AuthRequestError(
        "This reset link is invalid or has expired. Request a new link.",
      );
    if (await bcrypt.compare(body.password as string, user.password))
      throw new AuthRequestError(
        "Choose a different password from the one you already use.",
      );
    const password = await bcrypt.hash(body.password as string, 10);
    const grant = createSignInGrant();
    // One atomic write consumes the token, changes the password and invalidates all sessions.
    const updated = await User.findOneAndUpdate(
      {
        _id: user._id,
        suspended: { $ne: true },
        "passwordReset.digest": digest,
        "passwordReset.expiresAt": { $gt: new Date() },
      },
      {
        $set: { password, signInGrant: grant.stored },
        $unset: { passwordReset: 1 },
        $inc: { sessionVersion: 1 },
      },
      { new: true },
    );
    if (!updated)
      throw new AuthRequestError(
        "This reset link is invalid or has expired. Request a new link.",
      );
    after(async () => {
      try {
        await queueAccountEmail(
          String(updated._id),
          passwordChangedEmail(updated.email),
          `password-changed:${updated.id}:${updated.sessionVersion}`,
        );
      } catch {
        console.error("Password change notice could not be queued");
      }
    });
    return NextResponse.json(
      {
        message: "Your password is updated.",
        email: updated.email,
        signInToken: grant.token,
      },
      { headers: authHeaders },
    );
  } catch (error) {
    return authFailure(error);
  }
}
