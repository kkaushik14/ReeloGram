import { createHash, randomUUID } from "node:crypto";
import {
  redisClient,
  RedisUnavailableError,
  type RedisClient,
} from "../redis/client.ts";

export const PUBLIC_CACHE_TTL_SECONDS = 15;
export const PUBLIC_MUTATION_LEASE_MS = 120000;
const MAX_ENTRY_BYTES = 64 * 1024;
const prune = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
`;
export const READ_PUBLIC_CACHE_SCRIPT = `${prune}
local generation = redis.call('GET', KEYS[1])
if not generation then
  generation = ARGV[1]
  redis.call('SET', KEYS[1], generation, 'PX', ARGV[2])
end
if redis.call('ZCARD', KEYS[2]) > 0 then return {generation, '', 0} end
local value = redis.call('GET', KEYS[3])
if value and string.sub(value, 1, #generation + 1) == generation .. '\\n' then
  return {generation, string.sub(value, #generation + 2), 1}
end
return {generation, '', 1}
`;
export const WRITE_PUBLIC_CACHE_SCRIPT = `${prune}
if redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('ZCARD', KEYS[2]) > 0 then return 0 end
redis.call('SET', KEYS[3], ARGV[1] .. '\\n' .. ARGV[2], 'EX', ARGV[3])
return 1
`;
export const BEGIN_PUBLIC_MUTATION_SCRIPT = `${prune}
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
redis.call('ZADD', KEYS[2], now + tonumber(ARGV[3]), ARGV[2])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
return 1
`;
export const END_PUBLIC_MUTATION_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
redis.call('ZREM', KEYS[2], ARGV[2])
if redis.call('ZCARD', KEYS[2]) == 0 then redis.call('DEL', KEYS[2]) end
return 1
`;

export function publicCacheKeys(client: RedisClient, variant: string) {
  return [
    client.key("public:generation"),
    client.key("public:writers"),
    client.key(
      `public:page:${createHash("sha256").update(variant).digest("hex")}`,
    ),
  ];
}

/** Call only with a public DTO loader. Never pass account, mine, session or draft data. */
export async function readPublicData<T>(
  variant: string,
  load: () => Promise<T>,
  client: RedisClient | null = redisClient(),
): Promise<T> {
  if (!client) return load();
  const keys = publicCacheKeys(client, variant);
  let generation: string, writable: number;
  try {
    let cached: string;
    [generation, cached, writable] = await client.eval<
      [string, string, number]
    >(READ_PUBLIC_CACHE_SCRIPT, keys, [randomUUID(), PUBLIC_MUTATION_LEASE_MS]);
    if (cached && Buffer.byteLength(cached) <= MAX_ENTRY_BYTES) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        /* replace malformed data from MongoDB */
      }
    }
  } catch {
    return load();
  }
  const value = await load();
  if (writable) {
    const payload = JSON.stringify(value);
    if (payload && Buffer.byteLength(payload) <= MAX_ENTRY_BYTES) {
      try {
        await client.eval(WRITE_PUBLIC_CACHE_SCRIPT, keys, [
          generation,
          payload,
          PUBLIC_CACHE_TTL_SECONDS,
        ]);
      } catch {
        /* Cache failures never turn a successful public read into an error. */
      }
    }
  }
  return value;
}

/** Fence readers before changing public MongoDB data. Concurrent writers have
 * independent leases; an expired worker cannot remove another writer's lease.
 * Keep the enclosed DB work bounded below the 120-second lease (maxTimeMS=10000).
 */
export async function withPublicDataMutation<T>(
  work: () => Promise<T>,
  client: RedisClient | null = redisClient(),
): Promise<T> {
  if (!client) return work();
  const keys = publicCacheKeys(client, "mutation").slice(0, 2);
  const token = randomUUID();
  // Failure here aborts the write: never change data behind an uninvalidated cache.
  const begun = await client.eval(BEGIN_PUBLIC_MUTATION_SCRIPT, keys, [
    randomUUID(),
    token,
    PUBLIC_MUTATION_LEASE_MS,
  ]);
  if (begun !== 1) throw new RedisUnavailableError();
  try {
    return await work();
  } finally {
    try {
      await client.eval(END_PUBLIC_MUTATION_SCRIPT, keys, [
        randomUUID(),
        token,
        PUBLIC_MUTATION_LEASE_MS,
      ]);
    } catch {
      console.error(
        "Public cache bypass remains active until its short lease expires",
      );
    }
  }
}
