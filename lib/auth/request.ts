import { NextResponse } from "next/server";
export class AuthRequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function readAuthJson(
  request: Request,
): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new AuthRequestError("Use a JSON request.", 415);
  const origin = request.headers.get("origin");
  if (origin) {
    const allowed = new Set([new URL(request.url).origin]);
    for (const value of [process.env.REELOGRAM_APP_URL, process.env.REELOGRAM_NEXTAUTH_URL]) {
      if (value) allowed.add(new URL(value).origin);
    }
    if (!allowed.has(origin))
      throw new AuthRequestError("This request is not allowed.", 403);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AuthRequestError("Provide the required fields.");
  let bytes = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 8192) {
        await reader.cancel();
        throw new AuthRequestError("This request is too large.", 413);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const data = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error();
    return data;
  } catch {
    throw new AuthRequestError("Provide valid account details.");
  }
}
export const authHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
export function authFailure(
  error: unknown,
  fallback = "This service is temporarily unavailable. Please try again later.",
) {
  if (error instanceof AuthRequestError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: authHeaders },
    );
  if (error && typeof error === "object" && "retryAfter" in error)
    return NextResponse.json(
      { error: "Too many attempts. Please wait before trying again." },
      {
        status: 429,
        headers: { ...authHeaders, "Retry-After": String(error.retryAfter) },
      },
    );
  console.error(
    "Account request failed",
    error instanceof Error ? error.name : "Service error",
  );
  return NextResponse.json(
    { error: fallback },
    { status: 503, headers: authHeaders },
  );
}
