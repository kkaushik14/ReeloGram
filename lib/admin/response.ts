import { rateLimitResponse } from "../security/rate-limit.ts";
import { AdminRequestError } from "./config.ts";

export const adminHeaders = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};
export function adminFailure(error: unknown) {
  const limited = rateLimitResponse(error);
  if (limited) {
    for (const [name, value] of Object.entries(adminHeaders))
      limited.headers.set(name, value);
    return limited;
  }
  const status = error instanceof AdminRequestError ? error.status : 503;
  return Response.json(
    {
      error:
        error instanceof AdminRequestError
          ? status === 404
            ? "Not found"
            : error.message
          : "Administration is temporarily unavailable.",
    },
    {
      status,
      headers: {
        ...adminHeaders,
        ...(status === 503 ? { "Retry-After": "30" } : {}),
      },
    },
  );
}
