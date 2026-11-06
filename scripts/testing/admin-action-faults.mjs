// Test-only preload: never imported by production. No network to the fake host.
import { readFileSync } from "node:fs";
import { RATE_LIMIT_SCRIPT } from "../../lib/security/redis-rate-limit.ts";
const original = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  if (String(input) !== "https://isolated-test.upstash.io")
    return original(input, options);
  const mode = readFileSync(
    process.env.REELOGRAM_TEST_REDIS_FAULT_FILE,
    "utf8",
  ).trim();
  if (mode === "cache" && JSON.parse(options.body)[1] === RATE_LIMIT_SCRIPT)
    return Response.json({ result: 0 });
  if (mode === "quota")
    return Response.json({ error: "quota exceeded" }, { status: 429 });
  if (mode === "timeout")
    return new Promise((_, reject) => {
      if (options.signal.aborted) reject(options.signal.reason);
      else
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          { once: true },
        );
    });
  throw new TypeError("Synthetic Redis failure");
};
