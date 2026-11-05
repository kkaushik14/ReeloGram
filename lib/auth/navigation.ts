export function safeAuthDestination(callback: string | null, origin: string) {
  try {
    const url = new URL(callback || "/", origin);
    if (
      url.origin === origin &&
      !/^\/(?:login|register|forgot-password|reset-password|api)(?:\/|$)/.test(
        url.pathname,
      )
    )
      return url.pathname + url.search;
  } catch {}
  return "/";
}
