import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import WatchVideoPlayer from "@/app/components/WatchVideoPlayer";
import UploaderBadge from "@/app/components/UploaderBadge";
import VideoCredit from "@/app/components/VideoCredit";
import { getPublicVideo } from "@/lib/seo/videos";
import { absoluteUrl, videoPath, jsonLd } from "@/lib/seo/config";
import { pageMetadata } from "@/lib/seo/metadata";
import "./watch.css";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const video = await getPublicVideo((await params).id);
  if (!video) notFound();
  return pageMetadata(
    video.title,
    video.description.slice(0, 200),
    videoPath(video.id),
    video.thumbnailUrl,
  );
}
export default async function VideoPage({ params }: Props) {
  const { id } = await params;
  const video = await getPublicVideo(id);
  if (!video) notFound();
  if (id !== video.id) permanentRedirect(videoPath(video.id));
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "@id": absoluteUrl(videoPath(video.id)),
    url: absoluteUrl(videoPath(video.id)),
    name: video.title,
    description: video.description,
    thumbnailUrl: [video.thumbnailUrl],
    uploadDate: video.createdAt,
    contentUrl: video.videoUrl,
    author: video.source
      ? {
          "@type":
            video.source.creator === video.source.provider
              ? "Organization"
              : "Person",
          name: video.source.creator,
        }
      : video.uploader
        ? { "@type": "Person", name: video.uploader.name }
        : undefined,
  };
  return (
    <article className="content watch-page">
      <Link className="back-link" href="/">
        ← Back to discover
      </Link>
      <div className="page-heading">
        <h1>{video.title}</h1>
      </div>
      <WatchVideoPlayer
        src={video.videoUrl}
        poster={video.thumbnailUrl}
        title={video.title}
        dimensions={video.transformation}
      />
      <div className="video-meta">
        {video.uploader && <UploaderBadge uploader={video.uploader} />}
        {video.createdAt && (
          <time dateTime={video.createdAt}>
            {new Date(video.createdAt).toLocaleDateString("en", {
              year: "numeric",
              month: "long",
              day: "numeric",
              timeZone: "UTC",
            })}
          </time>
        )}
      </div>
      <p className="watch-description">{video.description}</p>
      <VideoCredit video={{ ...video, createdAt: video.createdAt ?? "" }} />
      <Link href="/reels" className="button secondary">
        Explore Reels
      </Link>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(structuredData) }}
      />
    </article>
  );
}
