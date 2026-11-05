import VideoFeed from "@/app/components/VideoFeed";
import { permanentRedirect } from "next/navigation";
import { pageMetadata } from "@/lib/seo/metadata";
import { validVideoId, videoPath } from "@/lib/seo/config";
type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export async function generateMetadata({ searchParams }: Props) {
  const query = await searchParams;
  const metadata = pageMetadata(
    "Discover videos",
    "Watch and share original videos on ReeloGram. Discover new perspectives and moments from the community.",
    "/",
  );
  // Search/filter combinations are useful in the UI, not separate search results.
  if (Object.keys(query).length)
    metadata.robots = { index: false, follow: true };
  return metadata;
}
export default async function Page({ searchParams }: Props) {
  const video = (await searchParams).video;
  if (typeof video === "string" && validVideoId(video))
    permanentRedirect(videoPath(video.toLowerCase()));
  return <VideoFeed />;
}
