import { Types } from "mongoose";
import { randomUUID } from "node:crypto";
import { AuthRequestError } from "../../security/request.ts";
import { withPublishingAccount } from "../../account/publishing-guard.ts";
import { accountAccess } from "../../account/access.ts";
import { parseVideoInput } from "../../video-input.ts";
import { publishVerifiedVideo } from "../publish-server";
import { validUploadId } from "./policy.ts";
import { uploadCollections, presentJob, type UploadJob } from "./repository.ts";
import { enqueueUpload } from "./queue.ts";
import { transferAsset, PermanentUploadError } from "./imagekit.ts";
import { removeObject } from "./storage.ts";
import User, { type InterFUser } from "@/models/User";

export async function dispatchJob(job: UploadJob) {
  const { jobs } = await uploadCollections();
  // Database intent survives queue outages. Claims prevent polling from flooding QStash.
  const claimed = await jobs.findOneAndUpdate(
    {
      _id: job._id,
      status: { $in: ["queued", "processing"] },
      $or: [
        { queuedAt: { $exists: false } },
        { queuedAt: { $lt: new Date(Date.now() - 15 * 60000) } },
      ],
    },
    { $set: { queuedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!claimed) return;
  try {
    await enqueueUpload(String(job._id));
  } catch {
    await jobs.updateOne(
      { _id: job._id, queuedAt: claimed.queuedAt },
      {
        $unset: { queuedAt: 1 },
        $set: {
          error:
            "Waiting for the upload service. Your files are saved; processing will retry.",
        },
      },
    );
    throw Error("Upload queue unavailable");
  }
}
export async function createJob(
  owner: { id: string; sessionVersion: number },
  body: Record<string, unknown>,
) {
  const { video, image } = body;
  const input = parseVideoInput({
    ...body,
    fileId: video,
    thumbnailFileId: image,
  });
  if (
    !validUploadId(video) ||
    !validUploadId(image) ||
    video === image ||
    !input
  )
    throw new AuthRequestError(
      "Choose both files and add a title and description.",
    );
  const { assets, jobs } = await uploadCollections();
  const id = new Types.ObjectId(video);
  const existing = await jobs.findOne({ _id: id, owner: owner.id });
  if (existing) {
    if (
      existing.image !== image ||
      existing.title !== input.title ||
      existing.description !== input.description
    )
      throw new AuthRequestError(
        "This upload was already submitted with different details.",
        409,
      );
    await dispatchJob(existing).catch(() => {});
    return presentJob(existing);
  }
  const job: UploadJob = {
    _id: id,
    owner: owner.id,
    sessionVersion: owner.sessionVersion,
    video,
    image,
    title: input.title,
    description: input.description,
    status: "queued",
    failures: 0,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 3600000),
  };
  await withPublishingAccount(
    owner.id,
    owner.sessionVersion,
    async (session) => {
      for (const [assetId, kind] of [
        [video, "video"],
        [image, "image"],
      ] as const) {
        const result = await assets.updateOne(
          {
            _id: new Types.ObjectId(assetId),
            owner: owner.id,
            kind,
            status: "ready",
            expiresAt: { $gt: new Date() },
          },
          {
            $set: { status: "claimed", jobId: video, expiresAt: job.expiresAt },
          },
          { session },
        );
        if (!result.matchedCount)
          throw new AuthRequestError(
            "An upload is incomplete, expired or already used. Retry the upload.",
            409,
          );
      }
      await jobs.insertOne(job, { session });
    },
  );
  await dispatchJob(job).catch(() => {});
  return presentJob(job);
}

export async function processJob(id: string) {
  if (!validUploadId(id)) return { done: true };
  const { jobs, assets } = await uploadCollections();
  const token = randomUUID();
  const now = new Date();
  const job = await jobs.findOneAndUpdate(
    {
      _id: new Types.ObjectId(id),
      status: { $in: ["queued", "processing"] },
      $and: [
        {
          $or: [
            { nextRetryAt: { $exists: false } },
            { nextRetryAt: { $lte: now } },
          ],
        },
      ],
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
    },
    {
      $set: {
        status: "processing",
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 90000),
      },
    },
    { returnDocument: "after" },
  );
  if (!job) {
    const current = await jobs.findOne({ _id: new Types.ObjectId(id) });
    return {
      done: !current || ["published", "failed"].includes(current.status),
      retryAfter: Math.max(
        1,
        Math.ceil(
          ((current?.nextRetryAt?.getTime() ??
            current?.leaseUntil?.getTime() ??
            Date.now() + 30000) -
            Date.now()) /
            1000,
        ),
      ),
    };
  }
  const guard = { _id: job._id, leaseToken: token };
  try {
    if (job.expiresAt <= now)
      throw new PermanentUploadError(
        "Processing expired. Please upload the video again.",
      );
    const owner = await User.findById(job.owner)
      .select("+suspended +dateOfBirth +emailVerifiedAt +parent")
      .lean<InterFUser>();
    if (
      !owner ||
      owner.suspended ||
      (owner.sessionVersion ?? 0) !== job.sessionVersion ||
      !accountAccess(owner).canPublish
    )
      throw new PermanentUploadError(
        "Your account can no longer publish this upload. Check your profile and sign in again.",
      );
    const records = await assets
      .find({ jobId: id, owner: job.owner, status: "claimed" })
      .toArray();
    const video = records.find((a) => String(a._id) === job.video),
      image = records.find((a) => String(a._id) === job.image);
    if (!video || !image)
      throw new PermanentUploadError(
        "The saved upload is unavailable. Please choose your files again.",
      );
    // One external transfer per invocation keeps processing within a bounded function lifetime.
    const pending = [video, image].find((asset) => !asset.fileId);
    if (pending) {
      const fileId = await transferAsset(pending);
      await assets.updateOne(
        { _id: pending._id, jobId: id, status: "claimed" },
        { $set: { fileId } },
      );
      await jobs.updateOne(guard, {
        $unset: { error: 1 },
        $set: { nextRetryAt: new Date(Date.now() + 1000) },
      });
      return { done: false, retryAfter: 1 };
    }
    const response = await publishVerifiedVideo(
      {
        title: job.title,
        description: job.description,
        fileId: video.fileId!,
        thumbnailFileId: image.fileId!,
        controls: true,
      },
      { id: job.owner, sessionVersion: job.sessionVersion },
      async (session) => {
        const result = await jobs.updateOne(
          { ...guard, status: "processing", leaseUntil: { $gt: new Date() } },
          {
            $set: { status: "published", videoId: id },
            $unset: { error: 1, nextRetryAt: 1 },
          },
          { session },
        );
        if (!result.matchedCount)
          throw new AuthRequestError(
            "The publication request has expired.",
            409,
          );
      },
    );
    if (!response.ok) {
      if ([400, 401, 403, 404].includes(response.status))
        throw new PermanentUploadError(
          "This video could not be published. Check your profile and file format before uploading again.",
        );
      throw Error("Publication temporarily unavailable");
    }
    const result = await response.json();
    await jobs.updateOne(guard, {
      $set: { status: "published", videoId: result.id },
      $unset: { error: 1, nextRetryAt: 1 },
    });
    await Promise.allSettled(
      records.map(async (asset) => {
        await removeObject(asset.key);
        await assets.updateOne(
          { _id: asset._id },
          { $set: { purgedAt: new Date() } },
        );
      }),
    );
    return { done: true };
  } catch (error) {
    const permanent =
      error instanceof PermanentUploadError || job.failures >= 7;
    const retryAfter = Math.min(900, 30 * 2 ** job.failures);
    await jobs.updateOne(
      { ...guard, status: { $ne: "published" } },
      {
        $inc: { failures: 1 },
        $set: permanent
          ? {
              status: "failed",
              expiresAt: new Date(),
              error:
                error instanceof PermanentUploadError
                  ? error.message
                  : "Processing could not finish. Please try uploading again.",
            }
          : {
              error:
                "The upload service is taking longer than expected. We will retry automatically.",
              nextRetryAt: new Date(Date.now() + retryAfter * 1000),
            },
      },
    );
    if (permanent) {
      await assets.updateMany(
        { jobId: id, owner: job.owner },
        { $set: { expiresAt: new Date() } },
      );
    }
    return { done: permanent, retryAfter };
  } finally {
    await jobs.updateOne(guard, { $unset: { leaseToken: 1, leaseUntil: 1 } });
  }
}
