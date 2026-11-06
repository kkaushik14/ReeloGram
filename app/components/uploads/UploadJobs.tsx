"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Info, LoaderCircle, ArrowUpRight } from "lucide-react";
import styles from "./UploadJobs.module.css";
import { UPLOAD_PUBLISHED_EVENT } from "@/lib/uploads/events";
import { uploadRequest } from "@/lib/uploads/resumable-client";
type Job = {
  id: string;
  title: string;
  status: string;
  error?: string;
  nextRetryAt?: string;
  videoId?: string;
};
export default function UploadJobs() {
  const [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState("");
  const known = useRef(new Map<string, string>());
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (document.visibilityState === "visible")
        try {
          const data = await uploadRequest(
            "/api/uploads/jobs",
            undefined,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          const next: Job[] = data.jobs;
          if (
            next.some(
              (job) =>
                job.status === "published" &&
                known.current.has(job.id) &&
                known.current.get(job.id) !== "published",
            )
          )
            window.dispatchEvent(new Event(UPLOAD_PUBLISHED_EVENT));
          known.current = new Map(next.map((job) => [job.id, job.status]));
          setJobs(next);
          setError("");
        } catch {
          if (!controller.signal.aborted)
            setError(
              "Upload status is temporarily unavailable. Your saved uploads are kept.",
            );
        }
      if (!controller.signal.aborted) timer = setTimeout(poll, 15000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  const outstanding = jobs.filter((job) => job.status !== "published");
  if (!outstanding.length && !error) return null;
  return (
    <section className={styles.activity} aria-label="Upload activity">
      <div className={styles.heading}>
        <h2>Upload activity</h2>
        <span>
          {outstanding.length
            ? `${outstanding.length} ${outstanding.length === 1 ? "upload" : "uploads"}`
            : "Status unavailable"}
        </span>
      </div>
      {error && (
        <p className={styles.notice} role="status">
          <Info size={18} aria-hidden="true" />
          {error}
        </p>
      )}
      <ul className={styles.list}>
        {outstanding.map((job) => (
          <li className={styles.row} key={job.id}>
            <span className={styles.icon} aria-hidden="true">
              {job.status === "failed" || job.error ? (
                <Info size={20} />
              ) : (
                <LoaderCircle className={styles.spinner} size={20} />
              )}
            </span>
            <div className={styles.details}>
              <div className={styles.title}>
                <h3>{job.title}</h3>
                <span className={styles.badge}>
                  {job.status === "failed"
                    ? "Needs attention"
                    : job.error
                      ? "Waiting to retry"
                      : job.status === "queued"
                        ? "Queued"
                        : "Publishing"}
                </span>
              </div>
              <p>
                {job.status === "failed"
                  ? job.error
                  : job.error || "Your files are saved. You can keep browsing."}
              </p>
              {job.status !== "published" &&
                job.status !== "failed" &&
                job.nextRetryAt &&
                job.error && (
                  <p className={styles.retry}>
                    Retry scheduled for{" "}
                    {new Date(job.nextRetryAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    .
                  </p>
                )}
            </div>
            {job.status === "failed" && (
              <Link className={styles.action} href="/upload">
                Upload again <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ul>
      <span className="sr-only" role="status">
        {outstanding.length} uploads awaiting publication.
      </span>
    </section>
  );
}
