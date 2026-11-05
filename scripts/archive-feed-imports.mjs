import assert from "node:assert/strict";
import { createRequire } from "node:module";
import mongoose from "mongoose";
import { featuredClips } from "./featured-clips.mjs";
const require = createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(
  process.cwd(),
);
assert.ok(process.env.MONGODB_URL, "Configure MongoDB first");
try {
  await mongoose.connect(process.env.MONGODB_URL, {
    serverSelectionTimeoutMS: 10000,
  });
  const videos = mongoose.connection.collection("videos");
  // Default: exact reviewed imports. --all-current archives a snapshot of the entire feed.
  const filter = process.argv.includes("--all-current")
    ? { placement: { $nin: ["hero", "archived"] } }
    : {
        "source.id": {
          $in: featuredClips
            .filter((clip) => clip.placement !== "hero")
            .map((clip) => clip.id),
        },
        uploadedBy: { $exists: false },
        placement: { $nin: ["hero", "archived"] },
      };
  const matching = await videos
    .find(filter, { projection: { title: 1 } })
    .toArray();
  console.log(
    `${matching.length} current feed videos selected. Banner clips are excluded. The default selects only reviewed editorial imports; --all-current also clears current community posts.`,
  );
  if (process.argv.includes("--apply")) {
    const result = await videos.updateMany(
      { _id: { $in: matching.map((video) => video._id) } },
      {
        $set: { placement: "archived", updatedAt: new Date() },
      },
    );
    console.log(
      `Archived ${result.modifiedCount} videos. ImageKit assets and credits are retained; feed and share links hide archived records.`,
    );
  } else
    console.log(
      "Use --apply to remove these imported videos from Browse and Reels.",
    );
} catch (error) {
  console.error("Archive failed:", error?.name ?? "Service error");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
