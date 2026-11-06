// Loaded ONLY by the isolated route-test child process, never by the application.
import { readFileSync } from "node:fs";
import { RATE_LIMIT_SCRIPT } from "../../lib/security/redis-rate-limit.ts";
const original = globalThis.fetch;
const target = new URL(process.env.REELOGRAM_KV_REST_API_URL).origin;
globalThis.fetch = async (input, options) => {
  if (String(input) !== target) return original(input, options);
  const mode = readFileSync(
    process.env.REELOGRAM_TEST_REDIS_FAULT_FILE,
    "utf8",
  ).trim();
  if (mode === "healthy") return original(input, options);
  if (
    mode === "cache-only" &&
    JSON.parse(options.body)[1] === RATE_LIMIT_SCRIPT
  )
    return original(input, options);
  if (mode === "timeout") {
    return new Promise((_, reject) => {
      const abort = () => reject(options.signal.reason);
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    });
  }
  if (mode === "quota")
    return Response.json({ error: "quota exceeded" }, { status: 429 });
  if (mode === "server") return new Response(null, { status: 503 });
  if (mode === "command")
    return Response.json({ error: "command limit exceeded" });
  if (mode === "malformed") return Response.json({ result: null });
  throw new TypeError("Synthetic Redis network failure");
};
