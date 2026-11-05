import { NextResponse } from "next/server";
import { parseEmail } from "@/lib/auth/validation";
import {
  readAuthJson,
  authFailure,
  authHeaders,
  AuthRequestError,
} from "@/lib/auth/request";
import { limitAuth } from "@/lib/auth/rate-limit";
import User from "@/models/User";
export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);
    const email = parseEmail(body.email);
    if (!email) throw new AuthRequestError("Enter a valid email address.");
    await limitAuth("identify", email, request.headers);
    const exists = await User.exists({ email });
    return NextResponse.json(
      { next: exists ? "login" : "register" },
      { headers: authHeaders },
    );
  } catch (error) {
    return authFailure(error);
  }
}
