import { after, NextResponse } from "next/server";
import { parseEmail, parseProfile, passwordError } from "@/lib/auth/validation";
import {
  readAuthJson,
  authFailure,
  authHeaders,
  AuthRequestError,
} from "@/lib/auth/request";
import { limitAuth } from "@/lib/auth/rate-limit";
import { queueEmail, deliverQueuedEmails } from "@/lib/email/outbox";
import { accountCreatedEmail } from "@/lib/email/templates";
import { appOrigin } from "@/lib/email/transport";
import { createSignInGrant } from "@/lib/auth/sign-in-grant";
import User from "@/models/User";
export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);
    const email = parseEmail(body.email);
    const profile = parseProfile(body);
    const problem = passwordError(body.password);
    if (!email) throw new AuthRequestError("Enter a valid email address.");
    if (!profile)
      throw new AuthRequestError("Enter your name and a valid date of birth.");
    if (problem) throw new AuthRequestError(problem);
    await limitAuth("register", email, request.headers);
    await User.init();
    const grant = createSignInGrant();
    const user = await User.create({
      signInGrant: grant.stored,
      email,
      password: body.password,
      ...profile,
    });
    after(async () => {
      try {
        const id = await queueEmail(
          accountCreatedEmail(email, profile.name, appOrigin()),
          `account-created:${user.id}`,
        );
        await deliverQueuedEmails(id);
      } catch {
        console.error("Welcome email could not be queued");
      }
    });
    return NextResponse.json(
      { message: "Account created", email, signInToken: grant.token },
      { status: 201, headers: authHeaders },
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    )
      return NextResponse.json(
        { error: "An account with this email already exists. Please sign in." },
        { status: 409, headers: authHeaders },
      );
    return authFailure(
      error,
      "Registration is unavailable. Please try again later.",
    );
  }
}
