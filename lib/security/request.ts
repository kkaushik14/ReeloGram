export class AuthRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new AuthRequestError("This request is not allowed.", 403);
  if (!origin) return;
  const allowed = new Set([new URL(request.url).origin]);
  for (const value of [
    process.env.REELOGRAM_APP_URL,
    process.env.REELOGRAM_NEXTAUTH_URL,
  ])
    if (value) allowed.add(new URL(value).origin);
  if (!allowed.has(origin))
    throw new AuthRequestError("This request is not allowed.", 403);
}
