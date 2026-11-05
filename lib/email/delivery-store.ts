import { createHash, randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import { connectToDatabase } from "../db.ts";
import { brevoAccount } from "./brevo.ts";

type Delivery = {
  _id: string;
  expiresAt: Date;
  sent?: boolean;
  leaseId?: string;
  leaseUntil?: Date;
  provider?: "brevo" | "smtp";
  uncertainAt?: Date;
  attemptedAt?: Date;
};
type Quota = {
  _id: string;
  slots: { id: string; at: Date }[];
  checkedAt?: Date;
  credits?: number;
  refreshUntil?: Date;
  refreshId?: string;
};
function duplicate(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === 11000
  );
}
export function createDeliveryStore(
  deliveries: Collection<Delivery>,
  quotas: Collection<Quota>,
  clock = () => new Date(),
) {
  return {
    async claim(key: string) {
      const now = clock(),
        id = createHash("sha256").update(key).digest("hex"),
        leaseId = randomUUID();
      await deliveries.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      try {
        await deliveries.updateOne(
          { _id: id },
          { $setOnInsert: { expiresAt: new Date(+now + 7 * 86400000) } },
          { upsert: true },
        );
      } catch (error) {
        if (!duplicate(error)) throw error;
      }
      const record = await deliveries.findOneAndUpdate(
        {
          _id: id,
          sent: { $ne: true },
          $or: [
            { leaseUntil: { $exists: false } },
            { leaseUntil: { $lte: now } },
          ],
        },
        { $set: { leaseId, leaseUntil: new Date(+now + 60000) } },
        { returnDocument: "after" },
      );
      if (record) {
        // A process can stop after Brevo accepts a message but before we save
        // success. Treat a reclaimed in-flight send as uncertain too.
        if (record.provider === "brevo" && record.attemptedAt) {
          const uncertainAt =
            record.uncertainAt && +record.uncertainAt < +record.attemptedAt
              ? record.uncertainAt
              : record.attemptedAt;
          await deliveries.updateOne(
            { _id: id, leaseId },
            { $min: { uncertainAt } },
          );
          record.uncertainAt = uncertainAt;
        }
        return record;
      }
      if ((await deliveries.findOne({ _id: id }))?.sent) return null;
      throw Error("Email delivery is already in progress");
    },
    async route(record: Delivery, provider: "brevo" | "smtp") {
      const result = await deliveries.updateOne(
        { _id: record._id, leaseId: record.leaseId },
        { $set: { provider } },
      );
      if (!result.matchedCount) throw Error("Email delivery lease expired");
      record.provider = provider;
    },
    async finish(record: Delivery) {
      await deliveries.updateOne(
        { _id: record._id, leaseId: record.leaseId },
        {
          $set: { sent: true },
          $unset: { leaseUntil: 1, leaseId: 1, uncertainAt: 1, attemptedAt: 1 },
        },
      );
    },
    async beginAttempt(record: Delivery) {
      const result = await deliveries.updateOne(
        { _id: record._id, leaseId: record.leaseId },
        { $set: { attemptedAt: clock() } },
      );
      if (!result.matchedCount) throw Error("Email delivery lease expired");
    },
    async release(record: Delivery, uncertain = false) {
      await deliveries.updateOne(
        { _id: record._id, leaseId: record.leaseId },
        {
          ...(uncertain ? { $min: { uncertainAt: clock() } } : {}),
          $unset: { leaseUntil: 1, leaseId: 1, attemptedAt: 1 },
        },
      );
    },
    async exhausted() {
      await quotas.updateOne(
        { _id: "brevo" },
        {
          $set: { credits: 0, checkedAt: clock() },
          $unset: { refreshId: 1, refreshUntil: 1 },
        },
      );
    },
    async reserve(id: string, limit: number, getCredits = brevoAccount) {
      const now = clock(),
        quotaId = "brevo";
      try {
        await quotas.updateOne(
          { _id: quotaId },
          { $setOnInsert: { slots: [] } },
          { upsert: true },
        );
      } catch (error) {
        if (!duplicate(error)) throw error;
      }
      let quota = await quotas.findOne({ _id: quotaId });
      const recent =
        quota?.slots.filter((slot) => +slot.at > +now - 86400000) || [];
      if (recent.some((slot) => slot.id === id)) return true;
      if (recent.length >= limit) return false;
      // Cache account reads across all serverless instances to respect Brevo's
      // account endpoint rate limit. New reservations still decrement atomically.
      if (!quota?.checkedAt || +quota.checkedAt <= +now - 120000) {
        const refreshId = randomUUID();
        const claimed = await quotas.findOneAndUpdate(
          {
            _id: quotaId,
            $and: [
              {
                $or: [
                  { checkedAt: { $exists: false } },
                  { checkedAt: { $lte: new Date(+now - 120000) } },
                ],
              },
              {
                $or: [
                  { refreshUntil: { $exists: false } },
                  { refreshUntil: { $lte: now } },
                ],
              },
            ],
          },
          { $set: { refreshId, refreshUntil: new Date(+now + 15000) } },
          { returnDocument: "after" },
        );
        if (claimed) {
          try {
            const credits = await getCredits();
            await quotas.updateOne(
              { _id: quotaId, refreshId },
              {
                $set: { credits, checkedAt: now },
                $unset: { refreshId: 1, refreshUntil: 1 },
              },
            );
          } catch (error) {
            await quotas.updateOne(
              { _id: quotaId, refreshId },
              { $unset: { refreshId: 1, refreshUntil: 1 } },
            );
            throw error;
          }
        }
        // Let concurrent cold starts share the in-flight account read instead
        // of each spending a provider request or dropping a confirmation email.
        for (let attempt = 0; attempt < 100; attempt++) {
          quota = await quotas.findOne({ _id: quotaId });
          if (quota?.checkedAt && +quota.checkedAt > +now - 120000) break;
          if (!quota?.refreshUntil || +quota.refreshUntil <= +clock()) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!quota?.checkedAt || +quota.checkedAt <= +now - 120000)
          throw Error("Brevo quota check is in progress; retry shortly");
      }
      const saved = await quotas.findOneAndUpdate(
        { _id: quotaId },
        [
          {
            $set: {
              slots: {
                $filter: {
                  input: "$slots",
                  as: "slot",
                  cond: { $gt: ["$$slot.at", new Date(+now - 86400000)] },
                },
              },
            },
          },
          {
            $set: {
              slots: {
                $cond: [
                  {
                    $and: [
                      { $not: [{ $in: [id, "$slots.id"] }] },
                      { $lt: [{ $size: "$slots" }, limit] },
                      {
                        $lt: [
                          {
                            $size: {
                              $filter: {
                                input: "$slots",
                                as: "slot",
                                cond: { $gte: ["$$slot.at", "$checkedAt"] },
                              },
                            },
                          },
                          "$credits",
                        ],
                      },
                    ],
                  },
                  { $concatArrays: ["$slots", [{ id, at: now }]] },
                  "$slots",
                ],
              },
            },
          },
        ],
        { returnDocument: "after" },
      );
      return !!saved?.slots.some((slot) => slot.id === id);
    },
  };
}
export async function deliveryStore() {
  const db = await connectToDatabase();
  return createDeliveryStore(
    db.collection<Delivery>("email_deliveries"),
    db.collection<Quota>("email_quotas"),
  );
}
