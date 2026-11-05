import { after, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { parseEmail, RESET_TOKEN_TTL_MS } from "@/lib/auth/validation";
import {
  readAuthJson,
  authFailure,
  authHeaders,
  AuthRequestError,
} from "@/lib/auth/request";
import { limitAuth } from "@/lib/auth/rate-limit";
import { appOrigin, emailConfigured, sendEmail } from "@/lib/email/transport";
import { passwordResetEmail } from "@/lib/email/templates";
import User from "@/models/User";
export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);
    const email = parseEmail(body.email);
    if (!email) throw new AuthRequestError("Enter a valid email address.");
    await limitAuth("forgot", email, request.headers);
    if (!emailConfigured()) throw Error("Email is not configured");
    const origin = appOrigin();
    // The response and work schedule are the same whether the account exists or not.
    after(async () => {
      try {
        const token = randomBytes(32).toString("base64url");
        const digest = createHash("sha256").update(token).digest("hex");
        const user = await User.findOneAndUpdate(
          { email },
          {
            $set: {
              passwordReset: {
                digest,
                expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
              },
            },
          },
        );
        if (!user) return;
        try {
          await sendEmail(
            passwordResetEmail(
              email,
              `${origin}/reset-password#token=${token}`,
            ),
            `reset-${digest}`,
          );
        } catch {
          await User.updateOne(
            { _id: user._id, "passwordReset.digest": digest },
            { $unset: { passwordReset: 1 } },
          );
          console.error("Password reset email delivery failed");
        }
      } catch {
        console.error("Password reset request could not be completed");
      }
    });
    return NextResponse.json(
      {
        message:
          "If an account uses that email, a reset link will arrive shortly. Check your spam folder too.",
      },
      { headers: authHeaders },
    );
  } catch (error) {
    return authFailure(
      error,
      "Password recovery is temporarily unavailable. Please try again later.",
    );
  }
}
