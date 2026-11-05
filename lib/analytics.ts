export const ANALYTICS_ID = "G-B6PDWD34WF";
export const CONSENT_KEY = "reelogram-cookie-consent";
export const CONSENT_EVENT = "reelogram:cookie-preferences";
export const CONSENT_LIFETIME_MS = 180 * 86400000;
export type CookieChoice = {
  version: 1;
  analytics: boolean;
  updatedAt: number;
};

export function readCookieChoice(
  value: string | null,
  now = Date.now(),
): CookieChoice | null {
  try {
    const choice = JSON.parse(value || "null");
    return choice?.version === 1 &&
      typeof choice.analytics === "boolean" &&
      Number.isFinite(choice.updatedAt) &&
      choice.updatedAt <= now + 300000 &&
      now - choice.updatedAt < CONSENT_LIFETIME_MS
      ? choice
      : null;
  } catch {
    return null;
  }
}

const pages: Record<string, string> = {
  "/": "Discover — ReeloGram",
  "/reels": "Reels — ReeloGram",
  "/my-videos": "Your videos — ReeloGram",
  "/upload": "Upload — ReeloGram",
  "/help": "Help — ReeloGram",
  "/terms": "Terms of use — ReeloGram",
  "/privacy": "Privacy policy — ReeloGram",
};

export function isAnalyticsPage(pathname: string) {
  return Object.hasOwn(pages, pathname);
}

/** No account pages, arbitrary paths, query strings, reset fragments or personal titles. */
export function analyticsPage(pathname: string, origin: string) {
  if (!isAnalyticsPage(pathname)) return null;
  return {
    page_location: new URL(pathname, new URL(origin).origin).href,
    page_title: pages[pathname],
  };
}
