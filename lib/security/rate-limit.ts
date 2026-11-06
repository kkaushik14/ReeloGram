import { createHmac } from "node:crypto";
import type { Connection } from "mongoose";
import { connectToDatabase } from "../db.ts";
import { clientAddress } from "./client-address.ts";
import { redisClient, RedisUnavailableError } from "../redis/client.ts";
import {
  SERVICE_UNAVAILABLE_MESSAGE,
  RATE_LIMIT_MESSAGE,
} from "../http/service-message.ts";
import { redisRateLimit } from "./redis-rate-limit.ts";

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
  profileWrite: [20, 100, 600],
  verification: [3, 30, 3600],
  parentMail: [3, 30, 3600],
  confirmation: [20, 100, 900],
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
  const redis = redisClient();
  if (redis) {
    const entries = [
      ...(subject
        ? [{ kind: "account", value: subject, maximum: policy[0] }]
        : []),
      { kind: "network", value: clientAddress(headers), maximum: policy[1] },
    ];
    const retryAfter = await redisRateLimit(
      redis,
      entries.map((entry) => ({
        id: createHmac("sha256", secret)
          .update(`${action}:${entry.kind}:${entry.value}`)
          .digest("hex"),
        maximum: entry.maximum,
      })),
      policy[2],
    );
    if (retryAfter > 0) throw new RateLimitError(retryAfter);
    return;
  }
  // Only unconfigured/explicitly disabled installations use MongoDB. An Upstash
  // outage must not silently reset counters or permit otherwise blocked requests.
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
  if (error instanceof RedisUnavailableError)
    return Response.json(
      { error: SERVICE_UNAVAILABLE_MESSAGE, code: "SERVICE_UNAVAILABLE" },
      {
        status: 503,
        headers: { "Retry-After": "30", "Cache-Control": "no-store" },
      },
    );
  if (!(error instanceof RateLimitError)) return null;
  return Response.json(
    { error: RATE_LIMIT_MESSAGE, code: "RATE_LIMITED" },
    {
      status: 429,
      headers: {
        "Retry-After": String(error.retryAfter),
        "Cache-Control": "no-store",
      },
    },
  );
}
