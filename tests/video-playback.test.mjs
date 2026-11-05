import assert from "node:assert/strict";
import { test } from "node:test";
import {
  selectVideoCap,
  progressiveVideoUrl,
  streamingVideoUrl,
  imageKitVideoBase,
  videoPreparationUrls,
  usesStableVideoQuality,
} from "../lib/video-playback.ts";

const endpoint = "https://ik.imagekit.io/account";
const src = endpoint + "/video.mp4?tr=w-320,q-40";
test("showcases use a stable sharp rendition while watching and Reels remain adaptive", () => {
  assert.equal(usesStableVideoQuality("hero"), true);
  assert.equal(usesStableVideoQuality("preview"), true);
  assert.equal(usesStableVideoQuality("reel"), false);
  assert.equal(usesStableVideoQuality("watch"), false);
  assert.match(progressiveVideoUrl(src, endpoint, 720), /q-80/);
  assert.match(progressiveVideoUrl(src, endpoint, 1080), /q-85/);
  assert.equal(selectVideoCap({ dpr: 2, downlink: 40 }, "preview", 400, {width:1080,height:1920}, 600), 1080);
});
test("fast, capable devices can use high-resolution sources, limited by the actual display and source", () => {
  assert.equal(
    selectVideoCap(
      { memory: 8, cores: 8, downlink: 40, dpr: 2 },
      "reel",
      1100,
      { width: 3840, height: 2160 },
    ),
    2160,
  );
  assert.equal(
    selectVideoCap({ memory: 8, cores: 8, downlink: 40, dpr: 2 }, "reel", 600, {
      width: 1080,
      height: 1920,
    }),
    1440,
  );
  assert.equal(
    selectVideoCap(
      { memory: 8, cores: 8, downlink: 40, dpr: 2 },
      "reel",
      1100,
      { width: 1280, height: 720 },
    ),
    720,
  );
  assert.equal(
    selectVideoCap({ memory: 8, cores: 8, downlink: 40, dpr: 2 }, "hero", 1000),
    2160,
  );
});
test("data-saving, weak hardware and slow networks bound quality independently", () => {
  for (const environment of [
    { saveData: true },
    { memory: 2 },
    { cores: 2 },
    { downlink: 1 },
  ])
    assert.equal(
      selectVideoCap({ ...environment, dpr: 2 }, "watch", 1100),
      360,
    );
  assert.equal(
    selectVideoCap({ effectiveType: "2g", dpr: 2 }, "reel", 1000),
    240,
  );
  assert.equal(
    selectVideoCap({ effectiveType: "3g", dpr: 2 }, "reel", 1000),
    480,
  );
  assert.equal(selectVideoCap({ downlink: 3, dpr: 2 }, "watch", 1000), 720);
  assert.equal(selectVideoCap({ dpr: 1 }, "reel", 300), 360);
});
test("ImageKit delivery strips old fixed transforms, preserves other query values and forbids original redirects", () => {
  const url = new URL(progressiveVideoUrl(src + "&v=1", endpoint, 360));
  assert.equal(url.searchParams.get("v"), "1");
  assert.match(url.searchParams.get("tr"), /h-360/);
  assert.match(url.searchParams.get("tr"), /ov-redirect_false/);
  assert.match(url.searchParams.get("tr"), /f-mp4/);
  assert.equal(
    imageKitVideoBase("https://ik.imagekit.io/other/video.mp4", endpoint),
    null,
  );
  assert.equal(
    progressiveVideoUrl("https://example.com/a.mp4", endpoint, 360),
    "https://example.com/a.mp4",
  );
  assert.match(
    imageKitVideoBase(endpoint + "/video.webm", endpoint).pathname,
    /video.webm\/ik-video.mp4$/,
  );
});
test("adaptive ladders contain only supported, useful resolutions and no incompatible transforms", () => {
  const stream = new URL(
    streamingVideoUrl(src, endpoint, "watch", { width: 3840, height: 2160 }),
  );
  assert.ok(stream.pathname.endsWith("/video.mp4/ik-master.m3u8"));
  assert.equal(
    stream.searchParams.get("tr"),
    "sr-240_360_480_720_1080_1440_2160",
  );
  const preview = new URL(streamingVideoUrl(src, endpoint, "preview"));
  assert.equal(preview.searchParams.get("tr"), "sr-240_360_480_720_1080");
  assert.equal(
    streamingVideoUrl("https://example.com/a.mp4", endpoint, "watch"),
    null,
  );
});

test("preparation reuses delivery profiles and never warms unrelated origins", () => {
  const urls = videoPreparationUrls(src, endpoint, "hero", {
    width: 1280,
    height: 720,
  });
  assert.ok(urls.length >= 4);
  assert.ok(urls.every((url) => url.startsWith(endpoint)));
  assert.ok(urls.some((url) => url.includes("h-240")));
  assert.ok(urls.some((url) => url.includes("ik-master.m3u8")));
  assert.deepEqual(
    videoPreparationUrls("https://example.com/a.mp4", endpoint),
    [],
  );
});

test("cover banners account for the crop width of portrait sources", () => {
  assert.equal(
    selectVideoCap(
      { dpr: 1, downlink: 40, cores: 8 },
      "hero",
      380,
      { width: 2160, height: 3840 },
      1100,
    ),
    2160,
  );
  assert.equal(
    selectVideoCap(
      { saveData: true, dpr: 1 },
      "hero",
      380,
      { width: 2160, height: 3840 },
      1100,
    ),
    360,
  );
});

test("single-resolution native HLS falls back to optimized MP4 rather than an invalid ImageKit manifest", () => {
  assert.equal(
    streamingVideoUrl(src, endpoint, "watch", { width: 960, height: 540 }, 240),
    null,
  );
  assert.equal(
    streamingVideoUrl(src, endpoint, "watch", { width: 32, height: 32 }),
    null,
  );
  assert.match(
    streamingVideoUrl(src, endpoint, "watch", { width: 960, height: 540 }, 360),
    /sr-240_360/,
  );
});
