"use client";
import FlashMessage from "./FlashNotification";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Play,
  Plus,
  Search,
  Film,
  X,
  Pencil,
  Trash2,
  Check,
  Copy,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
  Grid2X2,
  Clapperboard,
} from "lucide-react";
import Headline from "./motion/Headline";
import VideoCredit from "./VideoCredit";
import ResourceHero from "./ResourceHero";
import SourceBadge from "./SourceBadge";
import AdaptiveVideo from "./AdaptiveVideo";
import UploaderBadge, { type PublicUploader } from "./UploaderBadge";
import type { VideoSource } from "@/lib/video-sources";
import { FeedSkeleton, ReelSkeleton } from "./LoadingState";
import ReelStream from "./ReelStream";
export type FeedVideo = {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  thumbnailUrl: string;
  uploadedBy?: string;
  createdAt: string;
  transformation?: { width: number; height: number };
  uploader?: PublicUploader;
  source?: {
    provider: VideoSource;
    id: string;
    url: string;
    creator: string;
    license: string;
  };
};
function Modal({
  title,
  children,
  onClose,
  pending = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  pending?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else document.getElementById("main")?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-busy={pending}
      className="modal"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(event) => {
        if (pending || event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          disabled={pending}
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function VideoFeed({
  mine = false,
  reels = false,
}: {
  mine?: boolean;
  reels?: boolean;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [videos, setVideos] = useState<FeedVideo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [period, setPeriod] = useState("any");
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);
  const [total, setTotal] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const [watch, setWatch] = useState<FeedVideo | null>(null);
  const [edit, setEdit] = useState<FeedVideo | null>(null);
  const [remove, setRemove] = useState<FeedVideo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState("");
  const [playbackError, setPlaybackError] = useState(false);
  const [watchLoading, setWatchLoading] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const text = q.get("q") || "";
    setSearch(text.slice(0, 160));
    setQuery(text.slice(0, 160));
    setSort(q.get("sort") === "oldest" ? "oldest" : "newest");
    setPeriod(
      ["week", "month", "year"].includes(q.get("period") || "")
        ? q.get("period")!
        : "any",
    );
    setSource(
      ["pexels", "pixabay", "coverr", "mixkit", "community"].includes(
        q.get("source") || "",
      )
        ? q.get("source")!
        : "all",
    );
    setReady(true);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({
      q: query,
      sort: sort === "newest" ? "" : sort,
      period: period === "any" ? "" : period,
      source: source === "all" ? "" : source,
    })) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", url);
  }, [query, sort, period, source, ready]);
  const load = useCallback(
    async (next?: string) => {
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      const version = ++requestVersion.current;
      setLoading(true);
      setError("");
      try {
        const q = new URLSearchParams({
          limit: next ? "1" : "5",
          sort,
          period,
          source,
        });
        if (query) q.set("q", query);
        if (mine) q.set("mine", "true");
        if (next) q.set("cursor", next);
        const response = await fetch(`/api/videos?${q}`, {
          cache: "no-store",
          signal: request.signal,
        });
        if (!response.ok) throw Error();
        const data = await response.json();
        if (version !== requestVersion.current) return;
        setVideos((prev) =>
          next
            ? [
                ...prev,
                ...data.videos.filter(
                  (v: FeedVideo) => !prev.some((p) => p.id === v.id),
                ),
              ]
            : data.videos,
        );
        setCursor(data.nextCursor);
        setTotal(data.total);
      } catch {
        if (!request.signal.aborted)
          setError("We couldn’t load the videos. Please try again.");
      } finally {
        if (version === requestVersion.current && !request.signal.aborted)
          setLoading(false);
      }
    },
    [mine, query, sort, period, source],
  );
  const owner = mine ? session?.user.id : "public";
  const waiting = mine && status === "loading";
  useEffect(() => {
    if (!ready || waiting) return;
    if (mine && !owner) {
      setLoading(false);
      return;
    }
    void load();
    return () => controller.current?.abort();
  }, [ready, waiting, mine, owner, load]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("video");
    if (id)
      fetch(`/api/videos/${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then(setWatch)
        .catch(() => setNotice("This video is no longer available."));
  }, []);
  const visible = videos;
  const filtering =
    !!query || sort !== "newest" || period !== "any" || source !== "all";
  function clearFilters() {
    setSearch("");
    setQuery("");
    setSort("newest");
    setPeriod("any");
    setSource("all");
  }
  const viewQuery = new URLSearchParams();
  if (query) viewQuery.set("q", query);
  if (sort !== "newest") viewQuery.set("sort", sort);
  if (period !== "any") viewQuery.set("period", period);
  if (source !== "all") viewQuery.set("source", source);
  const suffix = viewQuery.size ? `?${viewQuery}` : "";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setActionError("");
    try {
      const r = await fetch(`/api/videos/${edit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
        }),
      });
      if (!r.ok)
        throw Error(
          r.status === 403
            ? "Only the person who shared this video can edit it."
            : "We couldn’t save your changes. Please try again.",
        );
      const updated = await r.json();
      setVideos((old) => old.map((v) => (v.id === updated.id ? updated : v)));
      setEdit(null);
      setNotice("Your changes have been saved.");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteVideo() {
    if (!remove || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const r = await fetch(`/api/videos/${remove.id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) {
        const details = await r.json().catch(() => ({}));
        throw Error(
          r.status === 409 && details.error?.includes("missing tracked")
            ? "This video can’t be removed automatically because its original files aren’t linked."
            : r.status === 409
              ? "This video is busy. Wait a moment and try again."
              : r.status === 401
                ? "Please sign in again before deleting this video."
                : "We couldn’t finish removing this video. Please try again to complete it.",
        );
      }
      setVideos((old) => old.filter((v) => v.id !== remove.id));
      setTotal((value) => Math.max(0, value - 1));
      setRemove(null);
      setNotice("Your video has been deleted.");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={`content ${reels ? "reels-content" : ""} ${!mine && !reels ? "discover-content" : ""}`}
    >
      {(mine || reels) && (
        <div className="page-heading">
          <div>
            <Headline
              text={
                mine
                  ? "Your stories."
                  : reels
                    ? "Find your next moment."
                    : "See something new."
              }
            />
          </div>
          <Link href="/upload" className="button primary">
            <Plus size={20} /> Share a video
          </Link>
        </div>
      )}
      {!mine && !reels && (
        <ResourceHero suspended={!!watch || !!edit || !!remove} />
      )}
      <FlashMessage message={notice} variant="success" />
      <section aria-label="Videos" aria-busy={loading}>
        <div className="feed-toolbar">
          <div className="section-title">
            <h2>
              {mine
                ? "Your videos"
                : reels
                  ? "Now playing"
                  : "Discover stories"}
            </h2>
            <span className="count">
              {loading && !videos.length ? "…" : total}
            </span>
          </div>
          <div className="feed-toolbar-actions">
            {reels && (
              <button
                className="button secondary filter-toggle"
                aria-expanded={filtersOpen}
                aria-controls="video-filters"
                onClick={() => setFiltersOpen((value) => !value)}
              >
                <SlidersHorizontal size={17} />
                Filters
                {filtering && (
                  <span className="filter-dot" aria-label="Filters applied" />
                )}
              </button>
            )}
            {!mine && (
              <nav className="view-switch" aria-label="Video view">
                <Link
                  href={`/${suffix}`}
                  aria-current={!reels ? "page" : undefined}
                >
                  <Grid2X2 size={16} />
                  Browse
                </Link>
                <Link
                  href={`/reels${suffix}`}
                  aria-current={reels ? "page" : undefined}
                >
                  <Clapperboard size={17} />
                  Reels
                </Link>
              </nav>
            )}
          </div>
        </div>
        {(!reels || filtersOpen) && (
          <div id="video-filters" className="filter-bar">
            <label className="search search-control">
              <Search size={18} />
              <input
                aria-label="Search videos"
                placeholder="Search stories, ideas, moments…"
                maxLength={160}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="clear-search"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearch("");
                    setQuery("");
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </label>
            <label className="filter-control">
              <SlidersHorizontal size={16} />
              <span className="sr-only">Sort videos</span>
              <select
                aria-label="Sort videos"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
              <ChevronDown size={15} />
            </label>
            <label className="filter-control">
              <span className="sr-only">Date shared</span>
              <select
                aria-label="Date shared"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                <option value="any">Any time</option>
                <option value="week">Past 7 days</option>
                <option value="month">Past 30 days</option>
                <option value="year">Past year</option>
              </select>
              <ChevronDown size={15} />
            </label>
            {!mine && (
              <label className="filter-control">
                <select
                  aria-label="Video source"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="all">All sources</option>
                  <option value="pexels">Pexels</option>
                  <option value="pixabay">Pixabay</option>
                  <option value="coverr">Coverr</option>
                  <option value="mixkit">Mixkit</option>
                  <option value="community">Community</option>
                </select>
                <ChevronDown size={15} />
              </label>
            )}
          </div>
        )}
        <div className="filter-summary" role="status" aria-live="polite">
          <span>
            {loading
              ? videos.length
                ? "Updating videos…"
                : "Finding stories…"
              : `${total} ${total === 1 ? "story" : "stories"}${filtering ? " found" : " to discover"}`}
          </span>
          {filtering && (
            <button onClick={clearFilters}>
              Clear filters <X size={13} />
            </button>
          )}
        </div>

        {mine && !session && status !== "loading" ? (
          <div className="empty">
            <div className="empty-icon">
              <Film />
            </div>
            <h3>Your stories have a home.</h3>
            <p>Sign in to see and manage the videos you’ve shared.</p>
            <Link
              href="/login?callbackUrl=/my-videos"
              className="button primary"
            >
              Sign in <ArrowRight size={17} />
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div>
                <FlashMessage message={error} />
                <button
                  className="button secondary"
                  onClick={() =>
                    load(cursor && videos.length ? cursor : undefined)
                  }
                >
                  <RefreshCw size={16} />
                  Try again
                </button>
              </div>
            )}
            {loading && !videos.length ? (
              <>
                <span className="sr-only" role="status">
                  Loading videos…
                </span>
                {reels ? <ReelSkeleton /> : <FeedSkeleton />}
              </>
            ) : !visible.length && !error ? (
              <div className="empty">
                <div className="empty-icon">
                  {filtering ? <Search /> : <Film />}
                </div>
                <span className="eyebrow">
                  {filtering ? "KEEP LOOKING" : "THE NEXT STORY COULD BE YOURS"}
                </span>
                <h3>
                  {filtering
                    ? "No matching stories."
                    : mine
                      ? "Your first story starts here."
                      : "A little quiet. A lot of possibility."}
                </h3>
                <p>
                  {filtering
                    ? "Try a different search or date, or clear the filters."
                    : mine
                      ? "Share a video and keep all your moments in one place."
                      : "There’s room for a fresh point of view. Share a moment worth watching."}
                </p>
                {filtering ? (
                  <button className="button secondary" onClick={clearFilters}>
                    Clear filters
                  </button>
                ) : (
                  <Link href="/upload" className="button primary">
                    <Plus size={17} />
                    Share a video
                  </Link>
                )}
              </div>
            ) : reels ? (
              <ReelStream
                key={`${query}:${sort}:${period}:${source}`}
                videos={visible}
                userId={session?.user.id}
                suspended={!!watch || !!edit || !!remove}
                cursor={cursor}
                hasMore={!!cursor}
                loading={loading}
                onMore={() => {
                  if (cursor) void load(cursor);
                }}
                onEdit={(video) => {
                  setActionError("");
                  setEdit(video);
                }}
                onDelete={(video) => {
                  setActionError("");
                  setRemove(video);
                }}
              />
            ) : (
              <div className="video-grid">
                {visible.map((video) => (
                  <article className="video-card" key={video.id}>
                    <button
                      className="thumbnail"
                      onClick={() => {
                        setCopied(false);
                        setShareError("");
                        setPlaybackError(false);
                        setWatch(video);
                      }}
                      aria-label={`Watch ${video.title}`}
                    >
                      <img
                        draggable={false}
                        src={video.thumbnailUrl}
                        alt=""
                        loading="lazy"
                      />
                      <span className="play-badge">
                        <Play size={21} fill="currentColor" />
                      </span>
                      <span className="watch-label">
                        Watch story <ArrowUpRight size={16} />
                      </span>
                    </button>
                    <div className="video-info">
                      <h3>
                        <button
                          onClick={() => {
                            setCopied(false);
                            setShareError("");
                            setPlaybackError(false);
                            setWatch(video);
                          }}
                        >
                          {video.title}
                        </button>
                      </h3>
                      <p>{video.description}</p>
                      <div className="video-meta">
                        {video.source ? (
                          <SourceBadge provider={video.source.provider} />
                        ) : (
                          <UploaderBadge
                            uploader={
                              video.uploader ?? {
                                id: video.uploadedBy ?? video.id,
                                name: "Community member",
                              }
                            }
                          />
                        )}
                        <time dateTime={video.createdAt}>
                          {new Date(video.createdAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </time>
                      </div>
                      <VideoCredit video={video} />
                      {!!session?.user.id &&
                        session.user.id === video.uploadedBy && (
                          <div className="owner-actions">
                            <button
                              onClick={() => {
                                setActionError("");
                                setEdit(video);
                              }}
                            >
                              <Pencil size={14} />
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                setActionError("");
                                setRemove(video);
                              }}
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          </div>
                        )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            {cursor && !reels && (
              <div className="load-more">
                <button
                  className="button secondary"
                  disabled={loading}
                  onClick={() => load(cursor)}
                >
                  {loading ? "Loading…" : "Next story"}
                  {loading ? (
                    <span className="motion-spinner" aria-hidden="true" />
                  ) : (
                    <ArrowRight size={17} />
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </section>
      {mine && (
        <section className="closing-note">
          <span className="small-icon">
            <Plus size={20} />
          </span>
          <div>
            <h3>Some moments deserve more than a camera roll.</h3>
            <p>Give yours a place to be seen.</p>
          </div>
          <Link href="/upload" className="text-button">
            Share a video <ArrowUpRight size={17} />
          </Link>
        </section>
      )}
      {watch && (
        <Modal
          title={watch.title}
          onClose={() => {
            setWatch(null);
            const url = new URL(window.location.href);
            url.searchParams.delete("video");
            router.replace(url.pathname + url.search, { scroll: false });
          }}
        >
          <AdaptiveVideo
            onPlaybackLoading={setWatchLoading}
            className="player"
            context="watch"
            sourceSize={watch.transformation}
            src={watch.videoUrl}
            poster={watch.thumbnailUrl}
            controls
            autoPlay
            playsInline
            onPlaybackError={() => setPlaybackError(true)}
          />
          {watchLoading && (
            <p className="video-status" role="status">
              Loading video…
            </p>
          )}
          {playbackError && (
            <FlashMessage message="This video can’t play in your browser right now. Try another browser or come back later." />
          )}
          {watch.uploader && <UploaderBadge uploader={watch.uploader} />}
          <p className="watch-description">{watch.description}</p>
          <VideoCredit video={watch} />
          <button
            className="button secondary"
            onClick={async () => {
              try {
                setShareError("");
                await navigator.clipboard.writeText(
                  `${window.location.origin}/?video=${watch.id}`,
                );
                setCopied(true);
              } catch {
                setShareError("Couldn’t copy the link. Please try again.");
              }
            }}
          >
            {copied && <FlashMessage message="Link copied" variant="success" />}
            {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
            {copied ? "Link copied" : "Copy link"}
          </button>
          {shareError && <FlashMessage message={shareError} />}
        </Modal>
      )}
      {edit && (
        <Modal
          pending={busy}
          title="Edit your video"
          onClose={() => {
            if (!busy) setEdit(null);
          }}
        >
          <form onSubmit={save} className="form-stack">
            <label>
              Title
              <input
                disabled={busy}
                name="title"
                defaultValue={edit.title}
                maxLength={120}
                required
              />
            </label>
            <label>
              Description
              <textarea
                disabled={busy}
                name="description"
                defaultValue={edit.description}
                maxLength={2000}
                required
                rows={4}
              />
            </label>
            {actionError && <FlashMessage message={actionError} />}
            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setEdit(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
                <span
                  aria-hidden="true"
                  className={`motion-spinner slot ${busy ? "running" : ""}`}
                />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal
          pending={busy}
          title="Delete this video?"
          onClose={() => {
            if (!busy) setRemove(null);
          }}
        >
          <p className="delete-copy">
            “{remove.title}” will be removed, along with its video file. This
            can’t be undone.
          </p>
          {actionError && <FlashMessage message={actionError} />}
          <div className="form-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRemove(null)}
            >
              Keep video
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={deleteVideo}
            >
              {busy ? (
                <span className="motion-spinner" aria-hidden="true" />
              ) : (
                <Trash2 size={16} />
              )}{" "}
              {busy ? "Deleting…" : "Delete video"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
