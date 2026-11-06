import { createHash, randomUUID } from "node:crypto";
import { redisClient, type RedisClient } from "./client.ts";

export const FINISH_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if tonumber(ARGV[2]) > 0 then
  redis.call('SET', KEYS[1], 'done', 'PX', ARGV[2])
else redis.call('DEL', KEYS[1]) end
return 1
`;

/** Only for bounded, repeatable background work; not durable email/payment delivery. */
export async function withTemporaryLease(
  resource: string,
  work: () => Promise<void>,
  options: { leaseMs: number; completedMs: number },
  client: RedisClient | null = redisClient(),
) {
  if (!client) {
    await work();
    return true;
  }
  if (
    options.leaseMs < 1000 ||
    options.leaseMs > 120000 ||
    options.completedMs < 0 ||
    options.completedMs > 600000
  )
    throw Error("Invalid temporary lease duration");
  const key = client.key(
    `work:${createHash("sha256").update(resource).digest("hex")}`,
  );
  const token = randomUUID();
  const acquired = await client.command<string | null>([
    "SET",
    key,
    token,
    "NX",
    "PX",
    options.leaseMs,
  ]);
  if (acquired !== "OK") return false;
  let completed = false;
  try {
    await work();
    completed = true;
    return true;
  } finally {
    // Never release a lease acquired by another worker after ours expired.
    await client.eval(
      FINISH_LEASE_SCRIPT,
      [key],
      [token, completed ? options.completedMs : 0],
    );
  }
}
