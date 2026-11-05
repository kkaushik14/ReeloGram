"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
export type PublicUploader = { id: string; name: string; image?: string };
export default function UploaderBadge({
  uploader,
}: {
  uploader: PublicUploader;
}) {
  const [failed, setFailed] = useState<string>();
  const initials =
    uploader.name
      .trim()
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join("")
      .toLocaleUpperCase() || "R";
  return (
    <span className="uploader-badge">
      <span className="uploader-avatar" aria-hidden="true">
        {uploader.image && failed !== uploader.image ? (
          <img
            src={uploader.image}
            alt=""
            width={32}
            height={32}
            loading="lazy"
            onError={() => setFailed(uploader.image)}
          />
        ) : (
          initials
        )}
      </span>
      <strong>{uploader.name}</strong>
    </span>
  );
}
