import { createHash } from "node:crypto";

export class RedisUnavailableError extends Error {
  constructor() {
    super("Shared request protection is temporarily unavailable");
  }
}
export type RedisCommand = (string | number)[];
export class RedisClient {
  private readonly url: string;
  private readonly token: string;
  readonly prefix: string;
  constructor(url: string, token: string, prefix: string) {
    this.url = url;
    this.token = token;
    this.prefix = prefix;
  }
  key(purpose: string) {
    return `${this.prefix}:${purpose}`;
  }
  async command<T>(command: RedisCommand): Promise<T> {
    try {
      const response = await fetch(this.url, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new RedisUnavailableError();
      const body = await response.json();
      if (!body || body.error || !("result" in body))
        throw new RedisUnavailableError();
      return body.result as T;
    } catch {
      throw new RedisUnavailableError();
    }
  }
  eval<T>(script: string, keys: string[], args: (string | number)[] = []) {
    return this.command<T>(["EVAL", script, keys.length, ...keys, ...args]);
  }
}

/** Server-side only. No read-only token, TCP credential or secret reaches browser bundles. */
export function redisClient(environment = process.env): RedisClient | null {
  if (environment.REELOGRAM_REDIS_DISABLED === "1") return null;
  const raw = environment.REELOGRAM_KV_REST_API_URL;
  const token = environment.REELOGRAM_KV_REST_API_TOKEN;
  if (!raw && !token) return null;
  if (!raw || !token) throw new RedisUnavailableError();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RedisUnavailableError();
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".upstash.io") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new RedisUnavailableError();
  const scope = environment.VERCEL_ENV || "development";
  // Separate previews by branch; deployments of the same production app share counters.
  const identity = `${environment.REELOGRAM_APP_URL || environment.REELOGRAM_NEXTAUTH_URL || "local"}:${scope === "preview" ? environment.VERCEL_GIT_COMMIT_REF || environment.VERCEL_URL : scope}`;
  const suffix = createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 16);
  const namespace =
    environment.REELOGRAM_REDIS_NAMESPACE || `${scope}:${suffix}`;
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(namespace))
    throw new RedisUnavailableError();
  return new RedisClient(url.origin, token, `reelogram:v1:${namespace}`);
}
