export const PREFERENCES_KEY = "reelogram-preferences";
export const PREFERENCES_EVENT = "reelogram:preferences";
export type VideoQuality = "auto" | "high" | "saver";
export type BrowserPreferences = {
  theme: "light" | "dark";
  quality: VideoQuality;
  autoplay: boolean;
};
export const DEFAULT_PREFERENCES: BrowserPreferences = {
  theme: "light",
  quality: "auto",
  autoplay: true,
};
export function parsePreferences(
  value: string | null,
  theme: string | null,
): BrowserPreferences {
  let parsed: Record<string, unknown> = {};
  try {
    const result = JSON.parse(value || "{}");
    if (result && typeof result === "object" && !Array.isArray(result))
      parsed = result;
  } catch {}
  return {
    theme: theme === "dark" ? "dark" : "light",
    quality:
      parsed.quality === "high" || parsed.quality === "saver"
        ? parsed.quality
        : "auto",
    autoplay: typeof parsed.autoplay === "boolean" ? parsed.autoplay : true,
  };
}
