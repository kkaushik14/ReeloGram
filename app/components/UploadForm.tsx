"use client";
import { useEffect, useRef, useState } from "react";
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
import { validateUpload } from "@/lib/upload-validation";
import { uploadToImageKit } from "@/lib/uploads/imagekit-upload";
import { FormSkeleton } from "./LoadingState";
import Headline from "./motion/Headline";
export default function UploadForm() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [video, setVideo] = useState<File | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState("");
  const uploaded = useRef<{ video?: string; image?: string }>({});
  useEffect(() => {
    if (!image) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (busy) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [busy]);
  function select(file: File | undefined, type: "video" | "image") {
    if (!file) return;
    if (type === "video" && !["video/mp4", "video/webm"].includes(file.type)) {
      setError("Choose an MP4 or WebM video so it can play in a browser.");
      return;
    }
    const message = validateUpload(file, type);
    if (message) {
      setError(message);
      return;
    }
    setError("");
    uploaded.current[type] = undefined;
    if (type === "video") setVideo(file);
    else setImage(file);
  }
  async function upload(file: File, type: "video" | "image") {
    if (uploaded.current[type]) return uploaded.current[type]!;
    const id = await uploadToImageKit(
      file, type, process.env.NEXT_PUBLIC_REELOGRAM_PUBLIC_KEY || "", setProgress,
    );
    uploaded.current[type] = id;
    return id;
  }
  async function publish(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (!video || !image) {
      setError("Choose a video and cover image first.");
      return;
    }
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      setStep("Uploading your video");
      setProgress(0);
      const fileId = await upload(video, "video");
      setStep("Uploading your cover");
      setProgress(0);
      const thumbnailFileId = await upload(image, "image");
      setStep("Publishing your video");
      setProgress(100);
      const response = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          fileId,
          thumbnailFileId,
        }),
      });
      if (!response.ok)
        throw Error(
          response.status === 409
            ? "This video is already shared or is busy. Check your videos before trying again."
            : "Your files are uploaded, but we couldn’t publish the video. Please try again.",
        );
      router.push("/my-videos");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
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
      {status === "loading" ? (
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
                  accept="video/mp4,video/webm"
                  disabled={busy}
                  aria-label="Choose video"
                  onChange={(e) => select(e.target.files?.[0], "video")}
                />
                <span className="empty-icon">
                  {video ? <Check /> : <Upload />}
                </span>
                <strong>{video ? video.name : "Choose your video"}</strong>
                <span>
                  {video
                    ? `${(video.size / 1024 / 1024).toFixed(1)} MB · Click to change`
                    : "Select a video from your device"}
                </span>
                <small>MP4 or WebM · Up to 100 MB</small>
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
                {preview ? (
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
            {busy && (
              <div role="status" aria-live="polite" className="upload-progress">
                <div>
                  <span>{step}</span>
                  <strong>{progress}%</strong>
                </div>
                <progress value={progress} max={100} />
                <p>Please keep this page open until your video is published.</p>
              </div>
            )}
            {error && (
              <div className="error-panel" role="alert">
                {error}
              </div>
            )}
            <div className="form-actions">
              <Link
                href="/my-videos"
                className={`button secondary ${busy ? "link-disabled" : ""}`}
                aria-disabled={busy}
                tabIndex={busy ? -1 : undefined}
              >
                Cancel
              </Link>
              <button className="button primary" disabled={busy}>
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
