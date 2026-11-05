import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mediaLocation,
  mediaUserFolder,
  namedUpload,
} from "../lib/uploads/naming.ts";
import {
  ownsUpload,
  createUploadAuthorization,
} from "../lib/uploads/authorization.ts";
import { serializeVideo } from "../lib/video-response.ts";

const owner = "0123456789abcdef01234567";
const videoId = "abcdef0123456789abcdef01";
const date = new Date("2026-11-06T05:30:12.123Z");

test("all media use the same safe user folder and readable UTC timestamps", () => {
  const shared = { ownerId: owner, name: "  Kumar Kaushik  ", date };
  const video = mediaLocation({ ...shared, purpose: "video", videoId });
  assert.deepEqual(video, {
    folder: `/users/${owner}-kumar-kaushik/videos`,
    fileName: `${owner}-2026-11-06_05-30-12-123-UTC-${videoId}`,
  });
  for (const purpose of ["profile", "thumbnail"]) {
    const location = mediaLocation({ ...shared, purpose });
    assert.equal(
      location.fileName,
      `${owner}-2026-11-06_05-30-12-123-UTC-current${purpose === "profile" ? ".webp" : ""}`,
    );
    assert.ok(location.folder.startsWith(`/users/${owner}-kumar-kaushik/`));
  }
  assert.deepEqual(
    namedUpload(`${video.folder}/${video.fileName}`, owner, "video"),
    { videoId },
  );
});

test("unusual names cannot inject folders, extensions or unsafe path characters", () => {
  assert.equal(
    mediaUserFolder(owner, "Élodie / ../../ Smith"),
    `/users/${owner}-elodie-smith`,
  );
  assert.equal(mediaUserFolder(owner, "李明"), `/users/${owner}-user`);
  assert.equal(mediaUserFolder(owner, undefined), `/users/${owner}-user`);
  assert.equal(
    mediaUserFolder(owner, "a".repeat(100)),
    `/users/${owner}-${"a".repeat(48)}`,
  );
  assert.throws(
    () => mediaUserFolder("../other", "Name"),
    /Invalid media owner/,
  );
  assert.throws(
    () =>
      mediaLocation({ ownerId: owner, purpose: "video", videoId: "../other" }),
    /Invalid video ID/,
  );
});

test("named uploads remain owner and purpose bound, with legacy V2 grants supported", () => {
  const location = mediaLocation({
    ownerId: owner,
    name: "Creator",
    purpose: "video",
    videoId,
    date,
  });
  const path = `${location.folder}/${location.fileName}`;
  assert.equal(ownsUpload({ filePath: path }, owner, "video"), true);
  assert.equal(ownsUpload({ filePath: path }, owner, "image"), false);
  assert.equal(ownsUpload({ filePath: path }, videoId, "video"), false);
  for (const invalid of [
    path + "/extra",
    path.replace("/videos/", "/../videos/"),
    path.replace(videoId, "forged"),
    path.replace(`${owner}-2026`, `${videoId}-2026`),
  ])
    assert.equal(ownsUpload({ filePath: invalid }, owner, "video"), false);
  assert.equal(
    ownsUpload(
      {
        filePath: `/users/${owner}/video/3f44657d-0520-4093-8f60-9527bd8143ae`,
      },
      owner,
      "video",
    ),
    true,
  );
  assert.equal(
    ownsUpload({ filePath: "/videos/legacy.mp4" }, owner, "video"),
    false,
  );
});

test("timestamp collisions cannot overwrite an existing thumbnail; video IDs stay unique", () => {
  const options = { name: "Creator", date };
  const image = createUploadAuthorization(
    owner,
    "image",
    "public",
    "private",
    options,
  );
  assert.equal(image.params.overwriteFile, "false");
  assert.equal(image.params.useUniqueFileName, "false");
  assert.equal(
    ownsUpload(
      { filePath: `${image.params.folder}/${image.params.fileName}` },
      owner,
      "image",
    ),
    true,
  );
  const first = createUploadAuthorization(
    owner,
    "video",
    "public",
    "private",
    options,
  );
  const second = createUploadAuthorization(
    owner,
    "video",
    "public",
    "private",
    options,
  );
  assert.notEqual(first.params.fileName, second.params.fileName);
});

test("existing video GET data keeps its original delivery URLs", () => {
  const video = serializeVideo({
    _id: videoId,
    videoUrl: "https://ik.imagekit.io/account/videos/original-name.mp4",
    thumbNailUrl:
      "https://ik.imagekit.io/account/images/original-cover.jpg?tr=f-jpg",
  });
  assert.equal(
    video.videoUrl,
    "https://ik.imagekit.io/account/videos/original-name.mp4",
  );
  assert.equal(
    video.thumbnailUrl,
    "https://ik.imagekit.io/account/images/original-cover.jpg?tr=f-jpg",
  );
});
