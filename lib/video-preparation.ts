import { videoPreparationUrls, type VideoDimensions } from "./video-playback";

/** ImageKit does the encoding; this only starts it after the save response. */
export async function prepareVideoPlayback(
  src: string,
  source?: VideoDimensions,
) {
  const endpoint = process.env.NEXT_PUBLIC_URL_ENDPOINT ?? "";
  const urls = videoPreparationUrls(src, endpoint, "watch", source);
  // Limit concurrent requests; never download the original or a complete rendition.
  for (let index = 0; index < urls.length; index += 2) {
    await Promise.allSettled(
      urls.slice(index, index + 2).map(async (url) => {
        const response = await fetch(url, {
          headers: { Range: "bytes=0-0" },
          signal: AbortSignal.timeout(5000),
          cache: "no-store",
        });
        await response.body?.cancel();
      }),
    );
  }
}
