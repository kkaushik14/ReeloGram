"use client";
import FlashMessage, { useFlash } from "../FlashNotification";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  ArrowUpRight,
  Upload,
  ImagePlus,
  Check,
  Film,
} from "lucide-react";
import { FormSkeleton } from "../LoadingState";
import Headline from "../motion/Headline";
import { useUploadDraft } from "./useUploadDraft";
export default function ResumableUploadForm() {
  const { data: session, status } = useSession();
  const flow = useUploadDraft(
    status === "loading" ? undefined : (session?.user.id ?? null),
  );
  const { state, select } = flow;
  const router = useRouter(),
    flash = useFlash();
  const busy = state.publishing;
  const checking =
    !flow.hydrated ||
    [state.video.phase, state.image.phase].includes("checking");
  const ready = state.video.phase === "ready" && state.image.phase === "ready";
  const video = state.video.name ? state.video : null,
    image = state.image.name ? state.image : null;
  const draft = { title: state.title, description: state.description };
  const error = state.error || state.video.error || state.image.error || "";
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!state.image.file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(state.image.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [state.image.file]);
  const setDraft = (update: (previous: typeof draft) => typeof draft) =>
    flow.dispatch({ type: "draft", ...update(draft) });
  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await flow.publish()) {
      flash(
        "Your files are saved. We’ll finish publishing in the background.",
        "success",
      );
      router.push("/my-videos");
      router.refresh();
    }
  }
  return (
    <div className="content upload-content">
      <Link href="/" className="back-link">
        <ArrowLeft size={16} />
        Back to discover
      </Link>
      <div className="eyebrow">
        <span className="tiny-line" />
        YOUR POINT OF VIEW
      </div>
      <div className="page-heading">
        <div>
          <Headline text="Give your story a place." />
          <p>A moment, an idea, a different way of seeing. Share it here.</p>
        </div>
      </div>
      {status === "loading" ||
      !flow.hydrated ||
      state.owner !== (session?.user.id ?? null) ? (
        <div role="status" aria-label="Loading upload form">
          <FormSkeleton />
        </div>
      ) : !session ? (
        <section className="empty">
          <div className="empty-icon">
            <Upload />
          </div>
          <h2>Your next story starts here.</h2>
          <p>Sign in to upload and share your video.</p>
          <Link className="button primary" href="/login?callbackUrl=/upload">
            Sign in to continue <ArrowUpRight size={16} />
          </Link>
        </section>
      ) : !session.user.canPublish ? (
        <section className="empty">
          <h2>Confirm your account before publishing.</h2>
          <p>
            {!session.user.emailVerified
              ? "Confirm your email address from Profile."
              : !session.user.profileComplete
                ? "Complete your name and date of birth in Profile."
                : "Your parent or guardian needs to confirm account management from their email."}
          </p>
          <Link className="button primary" href="/profile">
            Open Profile <ArrowUpRight size={16} />
          </Link>
        </section>
      ) : (
        <form onSubmit={publish} className="upload-layout">
          <div className="upload-main form-stack">
            <section className="form-panel">
              <div className="step-heading">
                <span>01</span>
                <div>
                  <h2>The moment</h2>
                  <p>Choose the video you want to share.</p>
                </div>
              </div>
              <label className={`file-drop ${video ? "selected" : ""}`}>
                <input
                  type="file"
                  accept="video/mp4,video/webm,image/gif"
                  disabled={busy}
                  aria-label="Choose video"
                  onChange={(e) => select(e.target.files?.[0], "video")}
                />
                <span className="empty-icon">
                  {video ? <Check /> : <Upload />}
                </span>
                <strong>
                  {checking
                    ? "Checking your file…"
                    : video
                      ? video.name
                      : "Choose your video"}
                </strong>
                <span>
                  {video
                    ? `${(video.size / 1024 / 1024).toFixed(1)} MB · Click to change`
                    : "Select a video from your device"}
                </span>
                <small>MP4, WebM or GIF · Up to 100 MB</small>
              </label>
            </section>
            <section className="form-panel">
              <div className="step-heading">
                <span>02</span>
                <div>
                  <h2>A few words</h2>
                  <p>Let people know what they’re about to see.</p>
                </div>
              </div>
              <label>
                Title
                <input
                  name="title"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Give your video a name"
                  maxLength={120}
                  required
                  disabled={busy}
                />
                <small>
                  Keep it clear and make it yours. Up to 120 characters.
                </small>
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  rows={4}
                  placeholder="What’s the story behind this moment?"
                  maxLength={2000}
                  required
                  disabled={busy}
                />
              </label>
            </section>
            <section className="form-panel">
              <div className="step-heading">
                <span>03</span>
                <div>
                  <h2>The first impression</h2>
                  <p>Add a cover that captures your story.</p>
                </div>
              </div>
              <label className="cover-drop">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Choose cover image"
                  disabled={busy}
                  onChange={(e) => select(e.target.files?.[0], "image")}
                />
                {image ? (
                  <span className="cover-file-name">
                    <Check size={20} />
                    {image?.name}
                  </span>
                ) : (
                  <>
                    <ImagePlus size={25} />
                    <strong>Choose a cover image</strong>
                    <span>JPG, PNG or WebP · Up to 5 MB</span>
                  </>
                )}
              </label>
            </section>
            {(["video", "image"] as const).map((kind) => {
              const asset = state[kind];
              if (asset.phase === "empty") return null;
              return (
                <div className="upload-progress" key={kind}>
                  <div>
                    <span>
                      {kind === "video" ? "Video" : "Cover"}:{" "}
                      {asset.phase === "ready"
                        ? "Saved privately"
                        : asset.phase === "error"
                          ? "Upload paused"
                          : asset.phase === "checking"
                            ? "Checking file"
                            : "Uploading"}
                    </span>
                    <strong>{asset.progress}%</strong>
                  </div>
                  <progress
                    aria-label={`${kind} upload progress`}
                    value={asset.progress}
                    max={100}
                  />
                  {asset.phase === "error" && asset.file && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void flow.retry(kind)}
                    >
                      Retry upload
                    </button>
                  )}
                </div>
              );
            })}
            <p role="status">
              {busy
                ? "Submitting your video…"
                : ready
                  ? "Your files are saved privately. Publish when you’re ready; processing will continue in the background."
                  : "Files upload while you add the details. Keep this page open until both files are saved."}
            </p>
            {error && <FlashMessage message={error} />}
            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  await flow.cancel();
                  router.push("/my-videos");
                }}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy || checking || !ready}
              >
                {busy ? "Publishing…" : "Publish video"}
                {busy ? (
                  <span className="motion-spinner" aria-hidden="true" />
                ) : (
                  <ArrowUpRight size={17} />
                )}
              </button>
            </div>
          </div>
          <aside className="upload-aside">
            <div className="preview-card">
              <span className="eyebrow">YOUR COVER</span>
              <div
                className="cover-preview"
                style={
                  preview
                    ? { backgroundImage: `url(${JSON.stringify(preview)})` }
                    : undefined
                }
              >
                {!preview && <Film size={40} />}
              </div>
              <h3>A small glimpse of your story.</h3>
              <p>Your cover helps someone decide what to watch next.</p>
            </div>
            <div className="upload-tips">
              <h3>A few things to keep in mind</h3>
              <p>
                <Check size={16} />
                Share work you have permission to post.
              </p>
              <p>
                <Check size={16} />
                Choose a clear, inviting cover.
              </p>
              <p>
                <Check size={16} />
                Your video will be visible to everyone.
              </p>
              <span>
                You can edit the title and description or remove your video at
                any time.
              </span>
            </div>
          </aside>
        </form>
      )}
    </div>
  );
}
