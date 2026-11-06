import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assetInput,
  validParts,
  partSize,
  STAGING_POLICY,
  matchesSignature,
} from "../lib/uploads/staging/policy.ts";
import {
  initialUploadState,
  emptyAsset,
  uploadReducer,
  savedDraft,
  restoreDraft,
} from "../lib/uploads/client-state.ts";
test("file declarations reject oversized, forged types and invalid numbers", () => {
  for (const size of [
    0,
    -1,
    Infinity,
    1.1,
    STAGING_POLICY.videoBytes + 1,
    "12",
  ])
    assert.equal(assetInput({ kind: "video", size, mime: "video/mp4" }), null);
  assert.equal(
    assetInput({ kind: "image", size: 100, mime: "image/svg+xml" }),
    null,
  );
  assert.ok(
    assetInput({
      kind: "video",
      size: STAGING_POLICY.videoBytes,
      mime: "video/mp4",
    }),
  );
});
test("multipart completion requires all parts, exact sizes and ETags", () => {
  const size = STAGING_POLICY.partBytes + 42;
  const parts = [
    { PartNumber: 1, Size: partSize(size, 1), ETag: "one" },
    { PartNumber: 2, Size: 42, ETag: "two" },
  ];
  assert.ok(validParts(parts, size));
  for (const invalid of [
    parts.slice(0, 1),
    [...parts].reverse(),
    [parts[0], { ...parts[1], Size: 43 }],
    [parts[0], { ...parts[1], ETag: "" }],
    [parts[0], parts[0]],
  ])
    assert.equal(validParts(invalid, size), false);
  assert.equal(
    matchesSignature(new TextEncoder().encode("xxxxftypisomxxxx"), "video/mp4"),
    true,
  );
  assert.equal(
    matchesSignature(new TextEncoder().encode("<svg>invalid</sv"), "video/mp4"),
    false,
  );
});
test("stale uploads cannot overwrite a replacement selection", () => {
  let state = initialUploadState("owner");
  state = uploadReducer(state, {
    type: "asset",
    kind: "video",
    value: { ...emptyAsset(2), name: "new.mp4", phase: "uploading" },
  });
  const stale = uploadReducer(state, {
    type: "progress",
    kind: "video",
    generation: 1,
    value: { id: "old", phase: "ready" },
  });
  assert.equal(stale, state);
  assert.equal(
    uploadReducer(state, { type: "reset", owner: "other" }).video.id,
    undefined,
  );
});
test("saved drafts are owner-scoped, expire and exclude file objects and incomplete uploads", () => {
  let state = initialUploadState("owner");
  state.title = "My draft";
  state.video = {
    ...emptyAsset(),
    name: "clip.mp4",
    size: 100,
    id: "a".repeat(24),
    phase: "ready",
    file: new File(["private"], "clip.mp4"),
  };
  state.image = { ...emptyAsset(), id: "b".repeat(24), phase: "uploading" };
  const raw = savedDraft(state);
  assert.ok(!raw.includes("private"));
  assert.equal(restoreDraft(raw, "owner").video.id, state.video.id);
  assert.equal(restoreDraft(raw, "owner").video.file, null);
  assert.equal(restoreDraft(raw, "owner").image.id, undefined);
  assert.equal(restoreDraft(raw, "other").title, "");
  assert.equal(
    restoreDraft(raw.replace(/"expiresAt":\d+/, '"expiresAt":0'), "owner")
      .title,
    "",
  );
});
