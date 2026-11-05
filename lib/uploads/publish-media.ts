type Media = { mime?: string; size: number; isPrivateFile: boolean };
export function publishMediaError(video: Media, cover: Media) {
  if (video.isPrivateFile || cover.isPrivateFile)
    return "The video and cover must be public files. Please upload them again.";
  if (!video.mime?.startsWith("video/") && video.mime !== "image/gif")
    return "The selected clip is not a video or GIF. Choose an MP4, WebM or GIF file.";
  if (video.size <= 0 || video.size > 100 * 1024 * 1024)
    return "Choose a video or GIF up to 100 MB.";
  if (!["image/jpeg", "image/png", "image/webp"].includes(cover.mime ?? ""))
    return "Choose a JPG, PNG or WebP cover image.";
  if (cover.size <= 0 || cover.size > 5 * 1024 * 1024)
    return "Choose a cover image up to 5 MB.";
  return null;
}

/** ImageKit's GIF conversion endpoint produces a playable MP4 without copying the original. */
export function publishedVideoUrl(
  file: { url: string; mime?: string },
  endpoint: string,
) {
  if (file.mime !== "image/gif") return file.url;
  const url = new URL(file.url),
    configured = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.origin !== configured.origin ||
    !url.pathname.startsWith(configured.pathname.replace(/\/$/, "") + "/")
  )
    throw Error("Unexpected media origin");
  url.hash = "";
  url.searchParams.delete("tr");
  url.pathname += "/ik-gif-video.mp4";
  return url.toString();
}
