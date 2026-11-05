import Link from "next/link";
export default function VideoNotFound() {
  return (
    <section className="content">
      <div className="empty">
        <h1>Video not found</h1>
        <p>This video may have been removed or is no longer available.</p>
        <Link href="/" className="button secondary">
          Browse videos
        </Link>
      </div>
    </section>
  );
}
