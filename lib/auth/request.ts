import { NextResponse } from "next/server";
import { rateLimitResponse } from "../security/rate-limit.ts";
import { AuthRequestError, assertSameOrigin } from "../security/request.ts";
export { AuthRequestError, assertSameOrigin } from "../security/request.ts";
export async function readAuthJson(
  request: Request,
): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase()
      .match(/^application\/json$/)
  )
    throw new AuthRequestError("Use a JSON request.", 415);
  assertSameOrigin(request);
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
  const protection = rateLimitResponse(error);
  if (protection) {
    protection.headers.set("Referrer-Policy", "no-referrer");
    return protection;
  }
  console.error(
    "Account request failed",
    error instanceof Error ? error.name : "Service error",
  );
  return NextResponse.json(
    { error: fallback },
    { status: 503, headers: authHeaders },
  );
}
