import { RedisUnavailableError, type RedisClient } from "../redis/client.ts";

// Redis time avoids clock differences across servers. Account rejection never
// consumes the shared network quota. Counters are capped and always expire.
export const RATE_LIMIT_SCRIPT = `
local clock = redis.call('TIME')
local now = tonumber(clock[1])
local seconds = tonumber(ARGV[1])
local window = math.floor(now / seconds)
local retry = (window + 1) * seconds - now
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[i + 1])
  local previous = tonumber(redis.call('HGET', key, 'window') or '-1')
  local count = 0
  if previous == window then count = tonumber(redis.call('HGET', key, 'count') or '0') end
  if count >= limit then return retry end
  redis.call('HSET', key, 'window', window, 'count', count + 1)
  redis.call('EXPIRE', key, retry + seconds)
end
return 0
`;

export async function redisRateLimit(
  client: RedisClient,
  buckets: { id: string; maximum: number }[],
  seconds: number,
) {
  const retry = await client.eval<number>(
    RATE_LIMIT_SCRIPT,
    buckets.map((b) => client.key(`rate:${b.id}`)),
    [seconds, ...buckets.map((b) => b.maximum)],
  );
  if (!Number.isInteger(retry) || retry < 0 || retry > seconds)
    throw new RedisUnavailableError();
  return retry;
}
