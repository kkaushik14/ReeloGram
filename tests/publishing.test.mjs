import { test } from "node:test";
import assert from "node:assert/strict";
import { validateClip } from "../lib/uploads/clip.ts";
import { publishVideo } from "../lib/uploads/publish.ts";
import {
  publishMediaError,
  publishedVideoUrl,
} from "../lib/uploads/publish-media.ts";
import {
  progressiveVideoUrl,
  streamingVideoUrl,
} from "../lib/video-playback.ts";

test("clip checks recognize a GIF mislabeled as MP4 and reject renamed non-media", async () => {
  assert.equal(
    await validateClip(
      new File(["GIF89a123456"], "clip.mp4", { type: "video/mp4" }),
    ),
    null,
  );
  assert.equal(
    await validateClip(
      new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], "clip.webm"),
    ),
    null,
  );
  assert.equal(
    await validateClip(new File(["0000ftypisom"], "clip.mp4")),
    null,
  );
  assert.match(
    await validateClip(
      new File(["%PDF-1.4"], "renamed.mp4", { type: "video/mp4" }),
    ),
    /Renaming/,
  );
  assert.match(await validateClip(new File([], "empty.mp4")), /empty/);
});
test("verified GIFs use ImageKit's video conversion without unsupported delivery options", () => {
  const endpoint = "https://ik.imagekit.io/account";
  const src = publishedVideoUrl(
    {
      url: endpoint + "/videos/mislabeled.mp4?updatedAt=123",
      mime: "image/gif",
    },
    endpoint,
  );
  assert.match(src, /mislabeled\.mp4\/ik-gif-video\.mp4/);
  const delivery = progressiveVideoUrl(src, endpoint, 720);
  assert.match(delivery, /f-mp4/);
  assert.ok(!delivery.includes("ov-redirect"));
  assert.equal(streamingVideoUrl(src, endpoint, "reel"), null);
  assert.throws(() =>
    publishedVideoUrl(
      { url: "https://other.invalid/clip.gif", mime: "image/gif" },
      endpoint,
    ),
  );
  const cover = { mime: "image/png", size: 100, isPrivateFile: false };
  assert.equal(
    publishMediaError(
      { mime: "image/gif", size: 100, isPrivateFile: false },
      cover,
    ),
    null,
  );
  assert.match(
    publishMediaError(
      { mime: "image/png", size: 100, isPrivateFile: false },
      cover,
    ),
    /not a video/,
  );
  assert.match(
    publishMediaError(
      { mime: "video/mp4", size: 100, isPrivateFile: true },
      cover,
    ),
    /public/,
  );
});
test("publish failures show the API reason without retrying or exposing proxy HTML", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(
      { error: "Choose a JPG, PNG or WebP cover image." },
      { status: 400 },
    );
  });
  const input = {
    title: "Clip",
    description: "Description",
    fileId: "video",
    thumbnailFileId: "cover",
  };
  await assert.rejects(publishVideo(input), /Choose a JPG/);
  assert.equal(calls, 1);
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>upstream failure</html>", { status: 504 }),
  );
  await assert.rejects(
    publishVideo(input),
    (error) =>
      !error.message.includes("html") &&
      /temporarily unavailable/.test(error.message),
  );
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("network");
  });
  await assert.rejects(
    publishVideo(input),
    /Check Your videos before trying again/,
  );
});
