"use client";
import { signIn } from "next-auth/react";
import { validResetToken } from "./validation";
/** Network failure here must never turn a successful account/password save into a retry. */
export async function completeSignIn(data: {
  email?: unknown;
  signInToken?: unknown;
}) {
  if (typeof data.email !== "string" || !validResetToken(data.signInToken))
    return false;
  try {
    const result = await signIn("credentials", {
      email: data.email,
      completionToken: data.signInToken,
      redirect: false,
    });
    return !!result && !result.error;
  } catch {
    return false;
  }
}
