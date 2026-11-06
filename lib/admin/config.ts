export class AdminRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const ADMIN_CAPABILITIES = [
  "accounts.read",
  "videos.read",
  "jobs.read",
] as const;
export const ADMIN_RESOURCES = [
  "manifest",
  "accounts",
  "videos",
  "jobs",
] as const;
export type AdminResource = (typeof ADMIN_RESOURCES)[number];
export type AdminEnvironment = "local" | "staging" | "production";
export type AdminCredential = {
  id: string;
  secret: string;
  expiresAt?: number;
};
export type AdminConfiguration = {
  projectId: string;
  environment: AdminEnvironment;
  audience: string;
  credentials: AdminCredential[];
};
export function adminNotFound(): never {
  throw new AdminRequestError(404, "Not found");
}
const identifier = /^[a-z][a-z0-9-]{1,39}$/;

export function adminConfiguration(
  env = process.env,
  now = Date.now(),
): AdminConfiguration {
  if (env.REELOGRAM_ADMIN_ENABLED !== "1") adminNotFound();
  const projectId = env.REELOGRAM_ADMIN_PROJECT_ID || "";
  const environment = env.REELOGRAM_ADMIN_ENVIRONMENT || "";
  const audience = env.REELOGRAM_ADMIN_AUDIENCE || "";
  const id = env.REELOGRAM_ADMIN_KEY_ID || "";
  const secret = env.REELOGRAM_ADMIN_SECRET || "";
  // Configuration failures are concealed too; only verified callers receive
  // operational 429/503 responses. Never infer the audience from Host headers.
  const validSecret = (value: string) =>
    value.length >= 32 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/[\r\n]/.test(value) &&
    value !== env.REELOGRAM_NEXTAUTH_SECRET;
  if (
    !identifier.test(projectId) ||
    !identifier.test(id) ||
    !validSecret(secret) ||
    !["local", "staging", "production"].includes(environment)
  )
    adminNotFound();
  try {
    const url = new URL(audience);
    if (
      url.origin !== audience ||
      url.username ||
      url.password ||
      (environment === "local"
        ? url.protocol !== "http:" ||
          !["localhost", "127.0.0.1"].includes(url.hostname)
        : url.protocol !== "https:" ||
          !!url.port ||
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      adminNotFound();
  } catch {
    adminNotFound();
  }
  if (
    (env.VERCEL_ENV === "production" && environment !== "production") ||
    (env.VERCEL_ENV === "preview" && environment !== "staging")
  )
    adminNotFound();
  const credentials: AdminCredential[] = [{ id, secret }];
  const previousId = env.REELOGRAM_ADMIN_PREVIOUS_KEY_ID || "";
  const previousSecret = env.REELOGRAM_ADMIN_PREVIOUS_SECRET || "";
  const previousUntil = env.REELOGRAM_ADMIN_PREVIOUS_VALID_UNTIL || "";
  if (previousId || previousSecret || previousUntil) {
    const expiresAt = Date.parse(previousUntil);
    if (
      !identifier.test(previousId) ||
      previousId === id ||
      !validSecret(previousSecret) ||
      previousSecret === secret ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(previousUntil) ||
      !Number.isFinite(expiresAt) ||
      expiresAt > now + 24 * 60 * 60 * 1000
    )
      adminNotFound();
    // Expired credentials are never selected, even if deployment settings remain.
    if (expiresAt > now)
      credentials.push({ id: previousId, secret: previousSecret, expiresAt });
  }
  return {
    projectId,
    environment: environment as AdminEnvironment,
    audience,
    credentials,
  };
}
