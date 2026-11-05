"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Pause,
  Pencil,
  Play,
  Trash2,
  Volume2,
  VolumeX,
  Maximize2,
  X,
} from "lucide-react";
import VideoCredit from "./VideoCredit";
import AdaptiveVideo from "./AdaptiveVideo";
import {useBrowserPreferences} from "./useBrowserPreferences";
import UploaderBadge from "./UploaderBadge";
import type { FeedVideo } from "./VideoFeed";

type Props = {
  videos: FeedVideo[];
  suspended: boolean;
  userId?: string;
  hasMore: boolean;
  loading: boolean;
  cursor: string | null;
  onMore: () => void;
  onEdit: (video: FeedVideo) => void;
  onDelete: (video: FeedVideo) => void;
};
export default function ReelStream({
  videos,
  suspended,
  userId,
  hasMore,
  loading,
  cursor,
  onMore,
  onEdit,
  onDelete,
}: Props) {
  const {preferences,ready:preferencesReady}=useBrowserPreferences();
  const root = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [active, setActive] = useState(videos[0]?.id);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const ambient = useRef<HTMLCanvasElement>(null);
  const lastPaint = useRef(0);
  const previous = useRef(active);
  const queued = useRef(0);
  const requestedCursor = useRef<string | null>(null);
  const index = Math.max(
    0,
    videos.findIndex((video) => video.id === active),
  );
  const current = videos[index];
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion:reduce)");
    if(preferencesReady)setPaused(media.matches || !preferences.autoplay);
    const change = () => {
      if (media.matches) setPaused(true);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [preferencesReady,preferences.autoplay]);
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    if (!videos.some((video) => video.id === active)) {
      setActive(videos[0]?.id);
      container.scrollTop = 0;
      queued.current = 0;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting && entry.intersectionRatio >= 0.65)
            setActive((entry.target as HTMLElement).dataset.videoId!);
      },
      { root: container, threshold: [0.65] },
    );
    container
      .querySelectorAll("[data-video-id]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [videos, active]);
  useEffect(() => {
    const oldIndex = videos.findIndex((video) => video.id === previous.current);
    if (previous.current !== active) {
      if (oldIndex >= 0 && index > oldIndex) queued.current++;
      previous.current = active;
      setProgress(0);
      setCopied(false);
      setError("");
      setBlocked(false);
      setPaused(matchMedia("(prefers-reduced-motion:reduce)").matches);
    }
  }, [active, index, videos]);
  useEffect(() => {
    if (
      queued.current > 0 &&
      hasMore &&
      !loading &&
      cursor &&
      cursor !== requestedCursor.current
    ) {
      queued.current--;
      requestedCursor.current = cursor;
      onMore();
    }
  }, [active, hasMore, loading, cursor, onMore]);
  function jump(next: number) {
    const target =
      root.current?.querySelectorAll<HTMLElement>("[data-video-id]")[
        Math.max(0, Math.min(videos.length - 1, next))
      ];
    if (target)
      root.current?.scrollTo({
        top: target.offsetTop,
        behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
          ? "instant"
          : "smooth",
      });
  }
  function toggle() {
    if (blocked) {
      setBlocked(false);
      setPaused(false);
      void player.current?.play().catch(() => setBlocked(true));
    } else setPaused((value) => !value);
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/?video=${current.id}`,
      );
      setCopied(true);
    } catch {
      setError("Couldn’t copy the link. Please try again.");
    }
  }
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    if (element.open) element.close();
    if (expanded) {
      element.showModal();
      document.body.style.overflow = "hidden";
      closeButton.current?.focus();
    } else {
      element.show();
      if (wasExpanded.current)
        expandButton.current?.focus({ preventScroll: true });
      else if (trigger?.isConnected && trigger.tagName !== "BODY")
        trigger.focus({ preventScroll: true });
      else document.getElementById("main")?.focus({ preventScroll: true });
    }
    wasExpanded.current = expanded;
    const selected = root.current?.querySelector<HTMLElement>(
      `[data-video-id="${active}"]`,
    );
    if (selected && root.current) root.current.scrollTop = selected.offsetTop;
    if (!paused && !suspended && !document.hidden)
      void player.current?.play().catch(() => setBlocked(true));
    return () => {
      element.close();
      if (expanded) document.body.style.overflow = overflow;
    };
    // Switching presentation keeps the existing player, active item, and playback state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);
  function paintAmbient() {
    const canvas = ambient.current;
    const element = player.current;
    if (
      !expanded ||
      !canvas ||
      !element ||
      element.readyState < 2 ||
      document.hidden ||
      Date.now() - lastPaint.current < 200
    )
      return;
    lastPaint.current = Date.now();
    try {
      canvas.getContext("2d")?.drawImage(element, 0, 0, 32, 18);
      canvas.dataset.ready = "true";
    } catch {}
  }
  const own = !!userId && userId === current?.uploadedBy;
  if (!current) return null;
  return (
    <dialog
      ref={dialog}
      className={`reels-container ${expanded ? "is-expanded" : ""}`}
      role={expanded ? "dialog" : "group"}
      aria-modal={expanded ? true : undefined}
      aria-label={expanded ? "Expanded Reels" : "Reels viewer"}
      onCancel={(event) => event.preventDefault()}
    >
      {expanded && (
        <>
          <div className="reels-ambient-clip" aria-hidden="true">
            <canvas
              ref={ambient}
              width={32}
              height={18}
              className="video-ambient reels-section-ambient"
            />
          </div>
          <header className="expanded-video-header">
            <h2>Reels</h2>
            <button
              ref={closeButton}
              className="expanded-close"
              aria-label="Close expanded Reels"
              onClick={() => setExpanded(false)}
            >
              <X size={22} />
            </button>
          </header>
        </>
      )}
      <div className="reels-layout clean-reels">
        <div className="reel-controls" aria-label="Video controls">
          <button
            className="icon-button"
            onClick={toggle}
            aria-label={paused || blocked ? "Play video" : "Pause video"}
            title={paused || blocked ? "Play" : "Pause"}
          >
            {paused || blocked ? <Play size={21} /> : <Pause size={21} />}
          </button>
          <button
            className="icon-button"
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? "Turn sound on" : "Turn sound off"}
            title={muted ? "Sound on" : "Sound off"}
          >
            {muted ? <VolumeX size={21} /> : <Volume2 size={21} />}
          </button>
          <button
            className="icon-button"
            onClick={share}
            aria-label={copied ? "Link copied" : "Share video"}
            title={copied ? "Copied" : "Share"}
          >
            {copied ? <Check size={20} /> : <Copy size={20} />}
          </button>
          {!expanded && (
            <button
              ref={expandButton}
              className="icon-button"
              aria-label="Expand Reels"
              title="Expand Reels"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 size={20} />
            </button>
          )}
          <div className="reel-control-divider" />
          <button
            className="icon-button"
            onClick={() => jump(index - 1)}
            disabled={index === 0}
            aria-label="Previous video"
            title="Previous video"
          >
            <ArrowUp size={21} />
          </button>
          <button
            className="icon-button"
            onClick={() => jump(index + 1)}
            disabled={index === videos.length - 1}
            aria-label="Next video"
            title="Next video"
          >
            <ArrowDown size={21} />
          </button>
          {loading && (
            <span
              className="motion-spinner"
              role="status"
              aria-label="Loading next video"
            />
          )}
        </div>
        <div className="reel-player-column">
          <div
            ref={root}
            className="reels-scroll"
            tabIndex={0}
            aria-label="Scroll through videos. Use the up and down arrow keys to change videos."
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (
                [
                  "ArrowDown",
                  "PageDown",
                  "ArrowUp",
                  "PageUp",
                  "Home",
                  "End",
                ].includes(event.key)
              ) {
                event.preventDefault();
                jump(
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? videos.length - 1
                      : index +
                        (["ArrowDown", "PageDown"].includes(event.key)
                          ? 1
                          : -1),
                );
              }
            }}
          >
            {videos.map((video, position) => (
              <article
                className={`reel-item ${video.id === active ? "is-current" : ""}`}
                data-video-id={video.id}
                key={video.id}
                aria-label={video.title}
                inert={video.id !== active}
              >
                <ReelVideo
                  video={video}
                  active={video.id === active && !suspended}
                  near={Math.abs(position - index) <= 1}
                  muted={muted}
                  paused={paused}
                  player={player}
                  onBlocked={setBlocked}
                  onLoading={setVideoLoading}
                  onProgress={(value) => {
                    setProgress(value);
                    paintAmbient();
                  }}
                  onError={() =>
                    setError(
                      "This video can’t play right now. Try the next video.",
                    )
                  }
                />
              </article>
            ))}
          </div>
          <input
            className="reel-timeline"
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={progress}
            aria-label={`Seek in ${current.title}`}
            onChange={(event) => {
              const element = player.current;
              if (element && Number.isFinite(element.duration)) {
                element.currentTime =
                  (Number(event.target.value) / 100) * element.duration;
                setProgress(Number(event.target.value));
              }
            }}
          />
        </div>
        <aside className="reel-details" aria-label="Current video details">
          <span className="reel-position">
            {index + 1} of {videos.length}
            {hasMore ? "+" : ""}
          </span>
          <h2>{current.title}</h2>
          <p>{current.description}</p>
          {videoLoading && (
            <p className="video-status" role="status">
              Loading video…
            </p>
          )}
          {current.uploader && <UploaderBadge uploader={current.uploader} />}
          <VideoCredit video={current} />
          {own && (
            <div className="owner-actions">
              <button onClick={() => onEdit(current)}>
                <Pencil size={16} />
                Edit
              </button>
              <button onClick={() => onDelete(current)}>
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          )}
          {blocked && (
            <p className="reel-help">Press play to start this video.</p>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {copied && (
            <p className="muted" role="status">
              Link copied
            </p>
          )}
          <p className="reel-help">
            Scroll or use <kbd>↑</kbd> <kbd>↓</kbd>
          </p>
        </aside>
      </div>
    </dialog>
  );
}

function ReelVideo({
  video,
  active,
  near,
  muted,
  paused,
  player,
  onBlocked,
  onLoading,
  onProgress,
  onError,
}: {
  video: FeedVideo;
  active: boolean;
  near: boolean;
  muted: boolean;
  paused: boolean;
  player: MutableRefObject<HTMLVideoElement | null>;
  onBlocked: (value: boolean) => void;
  onLoading: (value: boolean) => void;
  onProgress: (value: number) => void;
  onError: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (active) player.current = element;
    return () => {
      if (player.current === element) player.current = null;
    };
  }, [active, player]);
  return (
    <AdaptiveVideo
      ref={ref}
      src={near ? video.videoUrl : undefined}
      context="reel"
      prepare={near}
      active={active}
      playing={active && !paused}
      sourceSize={video.transformation}
      onPlaybackBlocked={onBlocked}
      onPlaybackLoading={(value) => {
        if (active) onLoading(value);
      }}
      poster={video.thumbnailUrl}
      muted={muted}
      loop
      playsInline
      preload="none"
      aria-hidden="true"
      onPlaybackError={() => {
        if (active) onError();
      }}
      onTimeUpdate={(event) => {
        const element = event.currentTarget;
        if (active && Number.isFinite(element.duration) && element.duration > 0)
          onProgress((element.currentTime / element.duration) * 100);
      }}
    />
  );
}
