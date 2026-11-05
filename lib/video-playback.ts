/** Shared delivery policy. Keep quality decisions here, not in individual screens. */
export const VIDEO_PLAYBACK = {
  levels: [240, 360, 480, 720, 1080, 1440, 2160],
  roleCaps: { reel: 2160, watch: 2160, hero: 2160, preview: 1080 },
  probeTimeoutMs: 2500,
  prepareTimeoutMs: 180000,
  retryIntervalMs: 1500,
  manifestRetryMs: 15000,
  streamStartupMs: 8000,
  maxBufferSeconds: 20,
  saverBufferSeconds: 8,
  stableStallMs: 8000,
} as const;

export type VideoRole = keyof typeof VIDEO_PLAYBACK.roleCaps;
export type PlaybackEnvironment = {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
  memory?: number;
  cores?: number;
  dpr?: number;
  quality?: "auto"|"high"|"saver";
};
export type VideoDimensions = { width?: number; height?: number };

/** Short looping showcases should not repeatedly change sharpness as HLS estimates vary. */
export function usesStableVideoQuality(role: VideoRole) {
  return role === "hero" || role === "preview";
}

export function selectVideoCap(
  environment: PlaybackEnvironment,
  role: VideoRole,
  renderedHeight = 720,
  source?: VideoDimensions,
  renderedWidth?: number,
) {
  const { saveData, effectiveType, downlink, memory, cores } = environment;
  let cap: number = VIDEO_PLAYBACK.roleCaps[role];
  if (
    saveData || environment.quality === "saver" ||
    (memory !== undefined && memory <= 2) ||
    (cores !== undefined && cores <= 2)
  )
    cap = Math.min(cap, 360);
  else if (
    (memory !== undefined && memory <= 4) ||
    (cores !== undefined && cores <= 4)
  )
    cap = Math.min(cap, 1080);
  if (effectiveType === "slow-2g" || effectiveType === "2g")
    cap = Math.min(cap, 240);
  else if (effectiveType === "3g") cap = Math.min(cap, 480);
  if (environment.quality !== "high" && downlink !== undefined && downlink > 0) {
    if (downlink < 0.7) cap = Math.min(cap, 240);
    else if (downlink < 1.5) cap = Math.min(cap, 360);
    else if (downlink < 4) cap = Math.min(cap, 720);
    else if (downlink < 10) cap = Math.min(cap, 1080);
    else if (downlink < 25) cap = Math.min(cap, 1440);
  }
  const fittedHeight =
    usesStableVideoQuality(role) && renderedWidth && source?.width && source.height
      ? Math.max(renderedHeight, (renderedWidth * source.height) / source.width)
      : renderedHeight;
  const needed = Math.max(
    240,
    fittedHeight * Math.min(environment.quality === "high" ? Math.max(environment.dpr??1,2) : environment.dpr??1, 2),
  );
  cap = Math.min(
    cap,
    VIDEO_PLAYBACK.levels.find((level) => level >= needed) ?? 2160,
  );
  if (source?.width && source.height) {
    const width = source.width;
    const height = source.height;
    const nativeCap =
      VIDEO_PLAYBACK.levels.find(
        (level) => level >= Math.min(height, (width * 9) / 16),
      ) ?? 2160;
    // Portrait representations are bounded by height, not the portrait's shorter width.
    const sourceCap =
      height > width
        ? (VIDEO_PLAYBACK.levels.find((level) => level >= height) ?? 2160)
        : nativeCap;
    cap = Math.min(cap, sourceCap);
  }
  return Math.max(240, cap);
}

export function imageKitVideoBase(src: string, endpoint: string) {
  try {
    const url = new URL(src);
    const configured = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.origin !== configured.origin ||
      !url.pathname.startsWith(configured.pathname.replace(/\/$/, "") + "/")
    )
      return null;
    url.searchParams.delete("tr");
    url.hash = "";
    url.pathname = url.pathname.replace(/\/ik-master\.m3u8$/, "");
    if (!/\.(mp4|mov)$/i.test(url.pathname)) url.pathname += "/ik-video.mp4";
    return url;
  } catch {
    return null;
  }
}

export function progressiveVideoUrl(
  src: string,
  endpoint: string,
  height: number,
) {
  const url = imageKitVideoBase(src, endpoint);
  if (!url) return src;
  const quality =
    height <= 360 ? 55 : height <= 720 ? 80 : 85;
  url.searchParams.set(
    "tr",
    `w-${Math.round((height * 16) / 9)},h-${height},c-at_max,q-${quality},f-mp4,ov-redirect_false`,
  );
  return url.toString();
}

export function streamingVideoUrl(
  src: string,
  endpoint: string,
  role: VideoRole,
  source?: VideoDimensions,
  maximum?: number,
) {
  const url = imageKitVideoBase(src, endpoint);
  if (!url) return null;
  let cap: number = Math.min(VIDEO_PLAYBACK.roleCaps[role], maximum ?? 2160);
  if (source?.height)
    cap = Math.min(
      cap,
      VIDEO_PLAYBACK.levels.find((level) => level >= source.height!) ?? 2160,
    );
  const levels = VIDEO_PLAYBACK.levels.filter((level) => level <= cap);
  // ImageKit rejects a single-rendition sr transformation; use optimized MP4 instead.
  if (levels.length < 2) return null;
  url.pathname += "/ik-master.m3u8";
  url.searchParams.set("tr", `sr-${levels.join("_")}`);
  return url.toString();
}

/** Eagerly request these delivery profiles after saving an upload. */
export function videoPreparationUrls(
  src: string,
  endpoint: string,
  role: VideoRole = "watch",
  source?: VideoDimensions,
) {
  if (!imageKitVideoBase(src, endpoint)) return [];
  const ceiling = selectVideoCap({ dpr: 2 }, role, 1080, source);
  return [
    ...new Set(
      [
        ...(usesStableVideoQuality(role) ? VIDEO_PLAYBACK.levels : [240, 360, 720, 1080])
          .filter((height) => height <= ceiling)
          .map((height) => progressiveVideoUrl(src, endpoint, height)),
        streamingVideoUrl(src, endpoint, role, source),
      ].filter((url): url is string => !!url),
    ),
  ];
}
