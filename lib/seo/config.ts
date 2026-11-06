import { appOrigin } from "../config/app-url.ts";
export { appOrigin as siteOrigin } from "../config/app-url.ts";
export const SITE_NAME = "ReeloGram";
export const SITE_DESCRIPTION =
  "Watch and share original videos on ReeloGram. Discover new perspectives, explore Reels, and share moments of your own.";
export const PUBLIC_PAGES = [
  "/",
  "/reels",
  "/help",
  "/terms",
  "/privacy",
] as const;
export const PRIVATE_PAGES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/confirm-parent",
  "/profile",
  "/settings",
  "/my-videos",
  "/upload",
] as const;
export const videoPath = (id: string) => `/videos/${id}`;
export const absoluteUrl = (path: string) => `${appOrigin()}${path}`;
export const validVideoId = (id: string) => /^[a-f0-9]{24}$/i.test(id);

/** Legacy feed records have no placement; everything else must explicitly be public. */
export const PUBLIC_VIDEO_FILTER = {
  hidden: { $ne: true },
  deletionPending: { $ne: true },
  $or: [{ placement: "feed" }, { placement: { $exists: false } }],
};

export function jsonLd(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function xml(value: unknown) {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(
      /[<>&"']/g,
      (char) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&apos;",
        })[char]!,
    );
}
