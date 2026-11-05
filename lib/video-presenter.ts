import User from "@/models/User";
import type { InterFVideo } from "@/models/Video";
import { serializeVideo } from "./video-response";
import { publicUploader } from "./public-uploader";

/** Resolve owners in one query, without exposing their email addresses. */
export async function presentVideos(videos: InterFVideo[]) {
  const ids = [
    ...new Set(
      videos.flatMap((video) =>
        video.uploadedBy ? [video.uploadedBy.toString()] : [],
      ),
    ),
  ];
  const users = ids.length
    ? await User.find({ _id: { $in: ids } })
        .select("_id name image email")
        .lean<
          { _id: unknown; name?: string; image?: string; email?: string }[]
        >()
    : [];
  const owners = new Map(
    users.map((user) => [String(user._id), publicUploader(user)]),
  );
  return videos.map((video) => ({
    ...serializeVideo(video),
    uploader: video.uploadedBy
      ? (owners.get(String(video.uploadedBy)) ??
        publicUploader({ _id: video.uploadedBy }))
      : undefined,
  }));
}
