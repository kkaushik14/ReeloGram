type Environment = Record<string, string | undefined>;

export class AppUrlConfigurationError extends Error {}

/** Trust deployment configuration, never visitor-controlled Host headers. */
export function appOrigin(environment: Environment = process.env): string {
  const value =
    environment.REELOGRAM_APP_URL || environment.REELOGRAM_NEXTAUTH_URL;
  if (!value)
    throw new AppUrlConfigurationError(
      "Set REELOGRAM_APP_URL to the application's public origin",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppUrlConfigurationError(
      "REELOGRAM_APP_URL must be a valid absolute URL",
    );
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new AppUrlConfigurationError(
      "Use an HTTPS origin without credentials, path, query or fragment; HTTP is allowed only on loopback hosts",
    );
  }
  return url.origin;
}
