import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createUploadAuthorization,
  ownsUpload,
} from "../lib/uploads/authorization.ts";
const owner = "0123456789abcdef01234567";
test("upload permission signs fixed ownership, overwrite prohibition, size and detected MIME checks", () => {
  const result = createUploadAuthorization(
    owner,
    "image",
    "public",
    "private",
    { name: "Video Creator", date: new Date(1000 * 1000) },
  );
  const [header, payload, signature] = result.token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), {
    alg: "HS256",
    typ: "JWT",
    kid: "public",
  });
  assert.equal(
    signature,
    createHmac("sha256", "private")
      .update(`${header}.${payload}`)
      .digest("base64url"),
  );
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.deepEqual(claims, { ...result.params, iat: 1000, exp: 2800 });
  assert.equal(claims.overwriteFile, "false");
  assert.equal(claims.useUniqueFileName, "false");
  assert.match(claims.checks, /5242880/);
  assert.ok(!claims.checks.includes("image/svg"));
  const file = { filePath: `${claims.folder}/${claims.fileName}` };
  assert.equal(ownsUpload(file, owner, "image"), true);
  for (const candidate of [
    {},
    { filePath: "/images/legacy" },
    { filePath: `${claims.folder}/../other` },
    { filePath: `${claims.folder}/${claims.fileName}/extra` },
  ])
    assert.equal(ownsUpload(candidate, owner, "image"), false);
  assert.equal(ownsUpload(file, "aaaaaaaaaaaaaaaaaaaaaaaa", "image"), false);
  assert.equal(ownsUpload(file, owner, "video"), false);
  assert.notEqual(
    createUploadAuthorization(owner, "video", "public", "private").params
      .fileName,
    createUploadAuthorization(owner, "video", "public", "private").params
      .fileName,
  );
});

test("public video records omit internal media IDs", async () => {
  const { serializeVideo } = await import("../lib/video-response.ts");
  const result = serializeVideo({
    _id: "public-id",
    fileId: "private-media-id",
    thumbnailFileId: "private-cover-id",
    title: "Public title",
  });
  assert.equal(result.title, "Public title");
  assert.ok(!("fileId" in result));
  assert.ok(!("thumbnailFileId" in result));
});
