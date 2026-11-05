"use client";
import { useState } from "react";
import AdaptiveVideo from "./AdaptiveVideo";
import FlashMessage from "./FlashNotification";
export default function WatchVideoPlayer({
  src,
  poster,
  title,
  dimensions,
}: {
  src: string;
  poster: string;
  title: string;
  dimensions?: { width: number; height: number };
}) {
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  return (
    <>
      <AdaptiveVideo
        className="player"
        src={src}
        poster={poster}
        aria-label={title}
        sourceSize={dimensions}
        context="watch"
        controls
        playsInline
        discoverable
        onPlaybackLoading={setLoading}
        onPlaybackError={() => setFailed(true)}
      />
      {loading && (
        <p className="video-status" role="status">
          Loading video…
        </p>
      )}
      {failed && (
        <FlashMessage message="This video can’t play right now. Please reload the page or try again later." />
      )}
    </>
  );
}
