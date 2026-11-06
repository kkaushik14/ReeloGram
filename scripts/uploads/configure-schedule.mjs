import { createRequire } from "node:module";
import { Client } from "@upstash/qstash";
import { appOrigin } from "../../lib/config/app-url.ts";
import { queueConfig } from "../../lib/uploads/staging/queue.ts";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
const originIndex = args.indexOf("--origin");
if (originIndex === -1 || !args[originIndex + 1])
  throw Error(
    "Pass --origin with the deployed HTTPS app origin. Add --apply to save.",
  );
const origin = appOrigin({ REELOGRAM_APP_URL: args[originIndex + 1] });
if (!origin.startsWith("https://"))
  throw Error(
    "The scheduled callback must use a publicly reachable HTTPS origin.",
  );
const definition = {
  scheduleId: "reelogram-upload-maintenance",
  destination: `${origin}/api/uploads/maintenance`,
  method: "POST",
  cron: "*/5 * * * *",
  retries: 3,
  timeout: 55,
  flowControl: { key: "reelogram-upload-maintenance", parallelism: 1 },
};
if (!args.includes("--apply")) {
  console.log(JSON.stringify({ ...definition, dryRun: true }, null, 2));
} else {
  const client = new Client(queueConfig());
  await client.schedules.create(definition);
  if (args.includes("--paused"))
    await client.schedules.pause({ schedule: definition.scheduleId });
  else await client.schedules.resume({ schedule: definition.scheduleId });
  const saved = await client.schedules.get(definition.scheduleId);
  if (
    saved.destination !== definition.destination ||
    saved.cron !== definition.cron ||
    saved.method !== "POST" ||
    saved.body ||
    saved.bodyBase64 ||
    saved.isPaused !== args.includes("--paused")
  )
    throw Error(
      "The saved schedule does not match the requested configuration.",
    );
  console.log(
    JSON.stringify(
      {
        id: saved.scheduleId,
        destination: saved.destination,
        cron: saved.cron,
        paused: saved.isPaused,
      },
      null,
      2,
    ),
  );
}
