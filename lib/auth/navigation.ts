export function safeAuthDestination(callback: string | null, origin: string) {
  try {
    const canonicalOrigin = new URL(origin).origin;
    const url = new URL(callback || "/", canonicalOrigin);
    const pathname = decodeURIComponent(url.pathname);
    if (
      url.origin === canonicalOrigin &&
      !pathname.startsWith("//") &&
      !/[\\\u0000-\u001f\u007f]/.test(pathname) &&
      !/^\/(?:login|register|forgot-password|reset-password|api)(?:\/|$)/.test(
        pathname,
      )
    )
      return url.pathname + url.search;
  } catch {}
  return "/";
}
