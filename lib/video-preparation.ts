import {
  videoPreparationUrls,
  type VideoDimensions,
} from "./video-playback.ts";
import { withTemporaryLease } from "./redis/lease.ts";

/** ImageKit does the encoding; this only starts it after the save response. */
export async function prepareVideoPlayback(
  src: string,
  source?: VideoDimensions,
) {
  const endpoint = process.env.NEXT_PUBLIC_REELOGRAM_URL_ENDPOINT ?? "";
  const urls = videoPreparationUrls(src, endpoint, "watch", source);
  if (!urls.length) return;
  try {
    await withTemporaryLease(
      JSON.stringify(urls),
      async () => {
        // Five-second probes, two at a time: the work finishes well before its lease.
        for (let index = 0; index < urls.length; index += 2) {
          const results = await Promise.allSettled(
            urls.slice(index, index + 2).map(async (url) => {
              const response = await fetch(url, {
                headers: { Range: "bytes=0-0" },
                signal: AbortSignal.timeout(5000),
                cache: "no-store",
              });
              await response.body?.cancel();
              if (!response.ok) throw Error("Video preparation unavailable");
            }),
          );
          if (results.some((result) => result.status === "rejected"))
            throw Error("Video preparation incomplete");
        }
      },
      { leaseMs: 60000, completedMs: 300000 },
    );
  } catch {
    // Optional warm-up must not interrupt publishing, playback or queued emails.
    // If Redis is unavailable, skip work rather than start duplicate workers.
    console.error("Optional video preparation deferred");
  }
}
