// Test-only preload for a fresh authentication server; no external Redis requests.
import { readFileSync } from "node:fs";
const original = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  if (String(input) !== "https://auth-test.upstash.io")
    return original(input, options);
  if (
    readFileSync(process.env.REELOGRAM_TEST_REDIS_FAULT_FILE, "utf8").trim() ===
    "quota"
  )
    return Response.json({ error: "quota exceeded" }, { status: 429 });
  const command = JSON.parse(options.body);
  if (command[0] !== "EVAL")
    throw Error("Unexpected authentication Redis command");
  return Response.json({ result: 0 });
};
