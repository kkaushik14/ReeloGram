import User from "../../models/User.ts";
import Video from "../../models/Video.ts";
import { connectToDatabase } from "../db.ts";
import { deleteMediaFile, withMediaLocks } from "../video-media.ts";

type CleanupJob = {
  _id: string;
  ownerId: string;
  nextAttemptAt: Date;
  leaseUntil?: Date;
  attempts: number;
};
export async function queueAvatarCleanup(fileId: string, ownerId: string) {
  const connection = await connectToDatabase();
  await connection
    .collection<CleanupJob>("avatar_cleanup")
    .updateOne(
      { _id: fileId },
      { $setOnInsert: { ownerId, nextAttemptAt: new Date(), attempts: 0 } },
      { upsert: true },
    );
}
export async function keepAvatar(fileId: string) {
  const connection = await connectToDatabase();
  await connection
    .collection<CleanupJob>("avatar_cleanup")
    .deleteOne({ _id: fileId });
}
/** Only IDs recorded by the server's avatar upload flow may enter this queue. */
export async function drainAvatarCleanup(fileId?: string) {
  const connection = await connectToDatabase();
  const jobs = connection.collection<CleanupJob>("avatar_cleanup");
  for (let count = 0; count < (fileId ? 1 : 20); count++) {
    const now = new Date();
    const job = await jobs.findOneAndUpdate(
      {
        ...(fileId ? { _id: fileId } : {}),
        nextAttemptAt: { $lte: now },
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }],
      },
      {
        $set: { leaseUntil: new Date(Date.now() + 90000) },
        $inc: { attempts: 1 },
      },
      { returnDocument: "after" },
    );
    if (!job) return;
    try {
      await withMediaLocks([job._id, `profile:${job.ownerId}`], async () => {
        const [profile, video] = await Promise.all([
          User.exists({ imageFileId: job._id }),
          Video.exists({
            $or: [{ fileId: job._id }, { thumbnailFileId: job._id }],
          }),
        ]);
        if (!profile && !video) await deleteMediaFile(job._id);
      });
      await jobs.deleteOne({ _id: job._id, leaseUntil: job.leaseUntil });
    } catch {
      await jobs.updateOne(
        { _id: job._id, leaseUntil: job.leaseUntil },
        {
          $unset: { leaseUntil: 1 },
          $set: {
            nextAttemptAt: new Date(
              Date.now() +
                Math.min(3600, 30 * 2 ** Math.min(job.attempts, 8)) * 1000,
            ),
          },
        },
      );
      console.error("Profile photo cleanup queued for retry");
    }
  }
}
