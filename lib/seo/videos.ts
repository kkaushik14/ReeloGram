import { cache } from "react";
import { connectToDatabase } from "@/lib/db";
import Video, { type InterFVideo } from "@/models/Video";
import User from "@/models/User";
import { publicUploader } from "@/lib/public-uploader";
import { PUBLIC_VIDEO_FILTER, validVideoId } from "./config";

export const SITEMAP_PAGE_SIZE = 1000;
export const VIDEO_SEO_FIELDS =
  "_id title description videoUrl thumbNailUrl createdAt updatedAt";

// React cache deduplicates metadata/page queries only within the current render.
// No persistent cache: removed or archived videos disappear on the next request.
export const getPublicVideo = cache(async (id: string) => {
  if (!validVideoId(id)) return null;
  await connectToDatabase();
  const video = await Video.findOne({ ...PUBLIC_VIDEO_FILTER, _id: id })
    .select(`${VIDEO_SEO_FIELDS} transformatioon source uploadedBy`)
    .maxTimeMS(5000)
    .lean<InterFVideo>();
  if (!video) return null;
  const owner = video.uploadedBy
    ? await User.findById(video.uploadedBy)
        .select("_id name image")
        .maxTimeMS(5000)
        .lean<{ _id: unknown; name?: string; image?: string }>()
    : null;
  return {
    id: String(video._id),
    title: video.title,
    description: video.description,
    videoUrl: video.videoUrl,
    thumbnailUrl: video.thumbNailUrl,
    createdAt: video.createdAt?.toISOString(),
    updatedAt: video.updatedAt?.toISOString(),
    transformation: video.transformatioon,
    source: video.source,
    uploader: owner ? publicUploader(owner) : undefined,
  };
});
