import assert from "node:assert/strict";
import { createRequire } from "node:module";
import mongoose from "mongoose";
import { videoPreparationUrls } from "../lib/video-playback.ts";
const require = createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(
  process.cwd(),
);
assert.ok(
  process.env.REELOGRAM_MONGODB_URL && process.env.REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT,
  "Configure MongoDB and ImageKit first",
);
try {
  await mongoose.connect(process.env.REELOGRAM_MONGODB_URL, {
    serverSelectionTimeoutMS: 10000,
  });
  const records = await mongoose.connection
    .collection("videos")
    .find({
      placement: process.argv.includes("--feed")
        ? { $nin: ["hero", "archived"] }
        : "hero",
      deletionPending: { $ne: true },
    })
    .toArray();
  const jobs = records.flatMap((video) =>
    videoPreparationUrls(
      video.videoUrl,
      process.env.REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT,
      video.placement === "hero" ? "hero" : "watch",
      video.transformatioon,
    ).map((url) => ({ title: video.title, url })),
  );
  if (!process.argv.includes("--apply")) {
    console.log(
      `${records.length} videos, ${jobs.length} delivery profiles. Use --apply to prepare them in ImageKit.`,
    );
  } else {
    let ready = 0,
      processing = 0,
      failed = 0;
    for (let index = 0; index < jobs.length; index += 2) {
      await Promise.all(
        jobs.slice(index, index + 2).map(async ({ title, url }) => {
          try {
            const response = await fetch(url, {
              headers: { Range: "bytes=0-0" },
              signal: AbortSignal.timeout(15000),
            });
            await response.body?.cancel();
            if (response.status === 200 || response.status === 206) ready++;
            else if (response.status === 202) processing++;
            else failed++;
            console.log(`${title}: ${response.status}`);
          } catch {
            processing++;
            console.log(
              `${title}: preparation requested; retry to check readiness`,
            );
          }
        }),
      );
    }
    console.log(
      `${ready} ready, ${processing} processing, ${failed} unavailable. Re-run to check processing profiles.`,
    );
    if (failed) process.exitCode = 1;
  }
} catch (error) {
  console.error("Video preparation failed:", error?.name ?? "Service error");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
