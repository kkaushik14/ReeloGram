import { randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import { connectToDatabase } from "../db.ts";
import { downloadBlocklist, parseBlocklist } from "./blocklist-source.mjs";
import bundled from "./disposable-domains.json" with { type: "json" };

export type BlocklistDocument = {
  _id: string;
  snapshot?: typeof bundled;
  nextAttemptAt: Date;
  leaseUntil: Date;
  leaseId?: string;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
};
export async function blocklistCollection() {
  return (await connectToDatabase()).collection<BlocklistDocument>(
    "email_blocklists",
  );
}

/** A shared lease prevents overlapping cron runs and stale workers overwriting newer data. */
export async function refreshStoredBlocklist(
  collection: Collection<BlocklistDocument>,
  download = downloadBlocklist,
  now = new Date(),
) {
  const id = "disposable-email";
  try {
    await collection.updateOne(
      { _id: id },
      { $setOnInsert: { nextAttemptAt: new Date(0), leaseUntil: new Date(0) } },
      { upsert: true },
    );
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
      )
    )
      throw error;
  }
  const leaseId = randomUUID();
  const claimed = await collection.findOneAndUpdate(
    { _id: id, nextAttemptAt: { $lte: now }, leaseUntil: { $lte: now } },
    { $set: { leaseId, leaseUntil: new Date(now.getTime() + 60000) } },
    { returnDocument: "after" },
  );
  if (!claimed) return { status: "not-due" as const };
  try {
    const snapshot = await download(
      fetch,
      claimed.snapshot?.domains.length || bundled.domains.length,
    );
    parseBlocklist(snapshot.domains.join("\n"));
    const saved = await collection.updateOne(
      { _id: id, leaseId },
      {
        $set: {
          snapshot,
          lastSuccessAt: now,
          nextAttemptAt: new Date(now.getTime() + 20 * 3600000),
          leaseUntil: new Date(0),
        },
        $unset: { leaseId: "", lastFailureAt: "" },
      },
    );
    if (!saved.matchedCount) throw Error("Blocklist refresh lease expired");
    return { status: "updated" as const, count: snapshot.domains.length };
  } catch (error) {
    await collection.updateOne(
      { _id: id, leaseId },
      {
        $set: {
          lastFailureAt: now,
          nextAttemptAt: new Date(now.getTime() + 3600000),
          leaseUntil: new Date(0),
        },
        $unset: { leaseId: "" },
      },
    );
    throw error;
  }
}

/** Warm workers read MongoDB at most once per five minutes; no upstream call during signup. */
export function createBlocklistReader(
  load: () => Promise<typeof bundled | null>,
  clock = Date.now,
) {
  let current = new Set(bundled.domains);
  let expires = 0;
  let pending: Promise<Set<string>> | null = null;
  return async () => {
    if (clock() < expires) return current;
    if (!pending)
      pending = (async () => {
        try {
          const snapshot = await load();
          if (snapshot)
            current = new Set(parseBlocklist(snapshot.domains.join("\n")));
        } catch {
          console.error(
            "Live email blocklist unavailable; retaining last validated list",
          );
        }
        expires = clock() + 5 * 60000;
        return current;
      })().finally(() => {
        pending = null;
      });
    return pending;
  };
}
export const liveBlocklist = createBlocklistReader(async () => {
  if (!process.env.REELOGRAM_MONGODB_URL) return null;
  const record = await (
    await blocklistCollection()
  ).findOne({ _id: "disposable-email" }, { projection: { snapshot: 1 } });
  return record?.snapshot || null;
});
