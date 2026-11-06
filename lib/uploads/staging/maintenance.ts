import { Types } from "mongoose";
import { uploadCollections } from "./repository.ts";
import { dispatchJob } from "./jobs";
import { removeObject } from "./storage.ts";
import { deleteMediaFile, withMediaLocks } from "../../video-media.ts";
import Video from "@/models/Video";
import { findTransferredAsset } from "./imagekit.ts";

/** Bounded batches; schedule every five minutes, with the daily cron as a backup. */
export async function maintainUploads() {
  const { assets, jobs } = await uploadCollections();
  const now = new Date();
  await jobs.updateMany(
    {
      status: { $in: ["queued", "processing"] },
      expiresAt: { $lte: now },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
    },
    {
      $set: {
        status: "failed",
        error: "Processing expired. Please upload again.",
      },
    },
  );
  const pending = await jobs
    .find({
      status: { $in: ["queued", "processing"] },
      expiresAt: { $gt: now },
      $or: [
        { queuedAt: { $exists: false } },
        { queuedAt: { $lt: new Date(Date.now() - 15 * 60000) } },
      ],
    })
    .limit(4)
    .toArray();
  let queued = 0,
    cleaned = 0;
  for (const job of pending) {
    try {
      await dispatchJob(job);
      queued++;
    } catch {
      /* The saved intent remains for the next run. */
    }
  }
  const stale = await assets
    .find({ purgedAt: { $exists: false }, expiresAt: { $lte: now } })
    .limit(4)
    .toArray();
  for (const asset of stale) {
    try {
      const job = asset.jobId
        ? await jobs.findOne({ _id: new Types.ObjectId(asset.jobId) })
        : null;
      if (job && !["published", "failed"].includes(job.status)) continue;
      if (job?.leaseUntil && job.leaseUntil > now) continue;
      await assets.updateOne(
        { _id: asset._id, status: { $ne: "claimed" } },
        { $set: { status: "cancelled" } },
      );
      await removeObject(asset.key, asset.multipartId);
      const fileId =
        job?.status === "failed"
          ? (asset.fileId ?? (await findTransferredAsset(asset)))
          : undefined;
      if (fileId)
        await withMediaLocks([fileId], async () => {
          if (
            !(await Video.exists({
              $or: [{ fileId }, { thumbnailFileId: fileId }],
            }))
          )
            await deleteMediaFile(fileId);
        });
      await assets.updateOne({ _id: asset._id }, { $set: { purgedAt: now } });
      cleaned++;
    } catch {
      /* Keep metadata until actual cleanup succeeds. */
    }
  }
  for (const job of await jobs
    .find({
      status: { $in: ["published", "failed"] },
      expiresAt: { $lte: now },
      purgeAt: { $exists: false },
    })
    .limit(10)
    .toArray()) {
    if (
      !(await assets.countDocuments({
        jobId: String(job._id),
        purgedAt: { $exists: false },
      }))
    )
      await jobs.updateOne(
        { _id: job._id },
        { $set: { purgeAt: new Date(Date.now() + 7 * 86400000) } },
      );
  }
  return { queued, cleaned };
}
