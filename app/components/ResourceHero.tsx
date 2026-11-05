"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Pause, Play } from "lucide-react";
import Headline from "./motion/Headline";
import AdaptiveVideo from "./AdaptiveVideo";
import type { FeedVideo } from "./VideoFeed";
import { useBrowserPreferences } from "./useBrowserPreferences";

const resources = [
  {
    name: "Pexels",
    url: "https://www.pexels.com/videos/",
    logo: "/brands/pexels.svg",
    color: "#05A081",
    background: "linear-gradient(115deg,#263e36,#647365)",
  },
  {
    name: "Pixabay",
    url: "https://pixabay.com/videos/",
    logo: "/brands/pixabay.svg",
    color: "#24342b",
    background: "linear-gradient(115deg,#253c37,#526d68)",
  },
  {
    name: "Coverr",
    url: "https://coverr.co/stock-video-footage",
    logo: "/brands/coverr.png",
    color: "#fff",
    background: "linear-gradient(115deg,#30364b,#666581)",
  },
  {
    name: "Mixkit",
    url: "https://mixkit.co/free-stock-video/",
    logo: "/brands/mixkit.png",
    color: "#fff",
    background: "linear-gradient(115deg,#41354a,#7c6573)",
  },
];

export default function ResourceHero({
  suspended = false,
}: {
  suspended?: boolean;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const { preferences, ready } = useBrowserPreferences();
  const [clips, setClips] = useState<FeedVideo[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [manualPlay, setManualPlay] = useState(false);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion:reduce)");
    const sync = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    sync();
    visibility();
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (paused || hovered || focused || reduced || hidden) return;
    const timer = setInterval(
      () => setIndex((value) => (value + 1) % resources.length),
      7000,
    );
    return () => clearInterval(timer);
  }, [paused, hovered, focused, reduced, hidden]);
  const resource = resources[index];
  const clip = clips.find((item) => item.source?.provider === resource.name);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/showcase", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setClips(data.videos))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const stopped =
    paused || blocked || ((reduced || !preferences.autoplay) && !manualPlay);
  function toggle() {
    if (stopped) {
      setPaused(false);
      setManualPlay(true);
      setBlocked(false);
      void player.current?.play().catch(() => setBlocked(true));
    } else setPaused(true);
  }

  return (
    <>
      <div className="resource-mobile-intro">
        <h1>See something new.</h1>
        <Link href="/reels" className="hero-cta">
          Explore Reels <ArrowUpRight size={21} />
        </Link>
      </div>
      <section
        className={`resource-hero ${paused ? "is-paused" : ""}`}
        aria-label="Discover free video resources"
        style={{ background: resource.background }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(false);
        }}
      >
        {clip && (
          <>
            <AdaptiveVideo
              active={!suspended}
              context="hero"
              playing={
                ready &&
                !paused &&
                !hidden &&
                (!reduced || manualPlay) &&
                (preferences.autoplay || manualPlay)
              }
              onPlaybackBlocked={setBlocked}
              sourceSize={clip.transformation}
              key={clip.id}
              ref={player}
              className="hero-background-video"
              src={clip.videoUrl}
              poster={clip.thumbnailUrl}
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden="true"
              onPlaybackError={() => setBlocked(true)}
            />
            <div className="hero-video-shade" aria-hidden="true" />
          </>
        )}
        <div className="resource-select" aria-label="Choose a video resource">
          {resources.map((item, position) => (
            <button
              key={item.name}
              type="button"
              aria-label={`Feature ${item.name}`}
              aria-pressed={position === index}
              onClick={() => setIndex(position)}
            >
              <span />
            </button>
          ))}
        </div>
        <div className="resource-heading">
          <Headline text={"See something\nnew."} />
          <Link href="/reels" className="hero-cta">
            Explore Reels <ArrowUpRight size={21} />
          </Link>
        </div>
        {!clip && (
          <div className="resource-film" aria-hidden="true">
            <div className="film-frame film-back" />
            <div className="film-frame film-front">
              <span className="film-play">
                <Play size={28} fill="currentColor" />
              </span>
              <span className="film-timeline">
                <i />
              </span>
            </div>
            <span className="film-spark" />
          </div>
        )}
        <div className="resource-footer">
          <div className="resource-playback">
            <button
              type="button"
              className="resource-pause"
              aria-label={
                stopped ? "Play featured video" : "Pause featured video"
              }
              aria-pressed={stopped}
              onClick={toggle}
            >
              {stopped ? <Play size={15} /> : <Pause size={15} />}
            </button>
            {clip?.source && (
              <a
                className="hero-video-credit"
                href={clip.source.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`By ${clip.source.creator}`}
              >
                By <strong>{clip.source.creator}</strong>
              </a>
            )}
          </div>
          <div className="resource-feature" key={resource.name}>
            <a
              href={resource.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Explore free videos on ${resource.name} (opens in a new tab)`}
            >
              <span
                className="resource-brand"
                style={{ background: resource.color }}
              >
                <img src={resource.logo} width="30" height="30" alt="" />
              </span>
              <strong>{resource.name}</strong>
              <ArrowUpRight size={20} />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
