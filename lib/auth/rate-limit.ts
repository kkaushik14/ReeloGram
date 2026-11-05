import { createHmac } from "node:crypto";
import { connectToDatabase } from "../db";
const policies = {
  identify: [20, 120, 10 * 60],
  login: [12, 100, 15 * 60],
  complete: [5, 100, 15 * 60],
  register: [5, 40, 60 * 60],
  forgot: [3, 20, 15 * 60],
  reset: [10, 50, 15 * 60],
} as const;
export class RateLimitError extends Error {
  constructor(public retryAfter: number) {
    super("Too many attempts");
  }
}
export async function limitAuth(
  action: keyof typeof policies,
  subject: string,
  headers: Headers,
) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw Error("Account protection is not configured");
  const connection = await connectToDatabase();
  const buckets = connection.collection<{
    _id: string;
    count: number;
    expiresAt: Date;
  }>("auth_rate_limits");
  await buckets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  const [accountMax, ipMax, seconds] = policies[action];
  const now = Date.now();
  const window = Math.floor(now / (seconds * 1000));
  const end = (window + 1) * seconds * 1000;
  // Forwarded headers are trusted only behind an explicitly configured, sanitizing proxy.
  const address =
    process.env.AUTH_TRUST_PROXY === "1"
      ? headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
      : "shared";
  const hash = (value: string) =>
    createHmac("sha256", secret).update(value).digest("hex");
  for (const [kind, value, maximum] of [
    ["account", subject, accountMax],
    ["network", address, ipMax],
  ] as const) {
    const _id = hash(`${action}:${kind}:${window}:${value}`);
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
