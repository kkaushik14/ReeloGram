import type { Types } from "mongoose";
import { connectToDatabase } from "../db.ts";
import { accountAccess } from "../account/access.ts";

const LIMIT = 100;
type Item = { id: string; label: string; detail: string; status: string };
const safeText = (value: unknown, fallback: string, maximum: number) =>
  typeof value === "string" && value.trim()
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, maximum)
    : fallback;
const result = (items: Item[]) => ({
  items: items.slice(0, LIMIT),
  truncated: items.length > LIMIT,
});

export async function readAccounts() {
  const connection = await connectToDatabase();
  const users = await connection
    .collection<{
      _id: Types.ObjectId;
      name?: string;
      dateOfBirth?: Date;
      emailVerifiedAt?: Date;
      parent?: { verifiedAt?: Date; ownerApprovedAt?: Date };
    }>("users")
    .find(
      {},
      {
        projection: {
          _id: 1,
          name: 1,
          dateOfBirth: 1,
          emailVerifiedAt: 1,
          "parent.verifiedAt": 1,
          "parent.ownerApprovedAt": 1,
        },
      },
    )
    .sort({ _id: -1 })
    .limit(LIMIT + 1)
    .maxTimeMS(3000)
    .toArray();
  return result(
    users.map((user) => {
      const access = accountAccess(user);
      const status = !access.profileComplete
        ? "profile-incomplete"
        : !access.emailVerified
          ? "email-pending"
          : access.parentRequired && !access.parentConfirmed
            ? "parent-pending"
            : "active";
      return {
        id: String(user._id),
        label: safeText(user.name, "Unnamed account", 80),
        status,
        detail: access.canPublish
          ? "Publishing enabled"
          : "Publishing not enabled",
      };
    }),
  );
}

export async function readVideos() {
  const connection = await connectToDatabase();
  const videos = await connection
    .collection<{
      _id: Types.ObjectId;
      title?: string;
      placement?: string;
      deletionPending?: boolean;
    }>("videos")
    .find(
      {},
      { projection: { _id: 1, title: 1, placement: 1, deletionPending: 1 } },
    )
    .sort({ _id: -1 })
    .limit(LIMIT + 1)
    .maxTimeMS(3000)
    .toArray();
  return result(
    videos.map((video) => ({
      id: String(video._id),
      label: safeText(video.title, "Untitled video", 120),
      status: video.deletionPending
        ? "deletion-pending"
        : video.placement === "archived"
          ? "archived"
          : "published",
      detail:
        video.placement === "hero"
          ? "Featured video"
          : video.placement === "archived"
            ? "Archived video"
            : "Browse and Reels video",
    })),
  );
}

export async function readJobs() {
  const connection = await connectToDatabase();
  // Only the notification outbox. Never inspect direct reset/confirmation delivery
  // records, provider credentials, message contents or recipient addresses.
  const jobs = await connection
    .collection<{
      _id: string;
      status: string;
      attempts?: number;
    }>("emailjobs")
    .find(
      {
        _id: { $regex: /^[a-f0-9]{64}$/ },
        expiresAt: { $gt: new Date() },
        status: { $in: ["pending", "sending", "failed"] },
      },
      { projection: { _id: 1, status: 1, attempts: 1 } },
    )
    .sort({ _id: -1 })
    .limit(LIMIT + 1)
    .maxTimeMS(3000)
    .toArray();
  return result(
    jobs.map((job) => ({
      id: String(job._id),
      label: "Account notification",
      status: job.status,
      detail: `${Number.isSafeInteger(job.attempts) && job.attempts! >= 0 ? Math.min(job.attempts!, 999) : 0} delivery attempts`,
    })),
  );
}
