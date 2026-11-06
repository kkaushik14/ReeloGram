import type { ClientSession } from "mongoose";
import { Types } from "mongoose";
import { connectToDatabase } from "../db.ts";
import { AuthRequestError } from "../security/request.ts";
/** Serializes publication against suspension: a shared user write makes MongoDB
 * detect conflicts even though the video lives in another collection. The caller
 * must perform only database work in this bounded transaction, never media I/O. */
export async function withPublishingAccount<T>(
  userId: string,
  sessionVersion: number,
  work: (session: ClientSession) => Promise<T>,
) {
  const c = await connectToDatabase();
  const session = await c.startSession();
  try {
    return await session.withTransaction(
      async () => {
        const active = await c
          .db!.collection("users")
          .updateOne(
            {
              _id: new Types.ObjectId(userId),
              suspended: { $ne: true },
              ...(sessionVersion === 0
                ? {
                    $or: [
                      { sessionVersion: 0 },
                      { sessionVersion: { $exists: false } },
                    ],
                  }
                : { sessionVersion }),
            },
            { $inc: { publishingRevision: 1 } },
            { session, maxTimeMS: 5000 },
          );
        if (!active.matchedCount)
          throw new AuthRequestError(
            "This account cannot publish right now.",
            403,
          );
        return work(session);
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        maxCommitTimeMS: 5000,
        timeoutMS: 20000,
      },
    );
  } finally {
    await session.endSession();
  }
}
