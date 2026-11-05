import { createHmac } from "node:crypto";
import type { Connection } from "mongoose";
import { connectToDatabase } from "../db.ts";
import { clientAddress } from "./client-address.ts";

export class RateLimitError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super("Too many attempts");
    this.retryAfter = retryAfter;
  }
}
const indexes = new WeakMap<Connection, Promise<unknown>>();
type Policy = readonly [
  accountLimit: number,
  networkLimit: number,
  seconds: number,
];
export const REQUEST_LIMITS = {
  feed: [300, 180, 60],
  showcase: [120, 90, 60],
  upload: [20, 80, 600],
  publish: [12, 60, 3600],
  mutation: [80, 240, 3600],
  profileRead: [90, 300, 300],
  avatar: [10, 40, 600],
} as const;

export async function enforceRateLimit(
  action: string,
  policy: Policy,
  subject: string | null,
  headers: Headers,
) {
  const secret = process.env.REELOGRAM_NEXTAUTH_SECRET;
  if (!secret) throw Error("Request protection is not configured");
  const connection = await connectToDatabase();
  const buckets = connection.collection<{
    _id: string;
    count: number;
    expiresAt: Date;
  }>("auth_rate_limits");
  let index = indexes.get(connection);
  if (!index) {
    index = buckets
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch((error) => {
        indexes.delete(connection);
        throw error;
      });
    indexes.set(connection, index);
  }
  await index;
  const [accountMax, networkMax, seconds] = policy;
  const now = Date.now(),
    window = Math.floor(now / (seconds * 1000)),
    end = (window + 1) * seconds * 1000;
  const entries: [string, string, number][] = [
    ["network", clientAddress(headers), networkMax],
  ];
  // Check the account bucket first; account-limited attacks must not lock out a shared network.
  if (subject) entries.unshift(["account", subject, accountMax]);
  for (const [kind, value, maximum] of entries) {
    const _id = createHmac("sha256", secret)
      .update(`${action}:${kind}:${window}:${value}`)
      .digest("hex");
    let result;
    try {
      result = await buckets.findOneAndUpdate(
        { _id },
        {
          $inc: { count: 1 },
          $setOnInsert: { expiresAt: new Date(end + seconds * 1000) },
        },
        { upsert: true, returnDocument: "after" },
      );
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== 11000
      )
        throw error;
      result = await buckets.findOneAndUpdate(
        { _id },
        { $inc: { count: 1 } },
        { returnDocument: "after" },
      );
      if (!result) throw Error("Rate limiter unavailable");
    }
    if (Number(result?.count) > maximum)
      throw new RateLimitError(Math.max(1, Math.ceil((end - now) / 1000)));
  }
}

export const limitRequest = (
  action: keyof typeof REQUEST_LIMITS,
  subject: string | null,
  headers: Headers,
) => enforceRateLimit(action, REQUEST_LIMITS[action], subject, headers);

export function rateLimitResponse(error: unknown) {
  if (!(error instanceof RateLimitError)) return null;
  return Response.json(
    { error: "Too many requests. Please wait before trying again." },
    {
      status: 429,
      headers: {
        "Retry-After": String(error.retryAfter),
        "Cache-Control": "no-store",
      },
    },
  );
}
