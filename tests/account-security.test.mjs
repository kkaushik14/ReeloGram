import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeAvatar, readAvatar } from "../lib/account/avatar.ts";
import { clientAddress } from "../lib/security/client-address.ts";
import { parsePreferences } from "../lib/preferences.ts";
import { selectVideoCap } from "../lib/video-playback.ts";

test("profile images are decoded, bounded and stripped of private metadata", async () => {
  const original = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#6A4D77" },
  })
    .withMetadata({ exif: { IFD0: { Artist: "Private photographer" } } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(original).metadata()).exif);
  const result = await normalizeAvatar(original);
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 384);
  assert.equal(metadata.height, 384);
  assert.equal(metadata.exif, undefined);
  await assert.rejects(
    normalizeAvatar(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
      ),
    ),
    /valid, still/,
  );
  await assert.rejects(
    normalizeAvatar(Buffer.from("not an image")),
    /valid, still/,
  );
});
test("avatar requests cannot change identity or come from another origin", async () => {
  const form = new FormData();
  form.set("file", new File(["bad"], "photo.png", { type: "image/png" }));
  form.set("email", "other@example.invalid");
  await assert.rejects(
    readAvatar(
      new Request("http://localhost/api/account/avatar", {
        method: "POST",
        body: form,
      }),
    ),
    /Only a profile photo/,
  );
  await assert.rejects(
    readAvatar(
      new Request("http://localhost/api/account/avatar", {
        method: "POST",
        headers: { Origin: "https://other.example" },
        body: form,
      }),
    ),
    (error) => error.status === 403,
  );
  await assert.rejects(
    readAvatar(
      new Request("http://localhost/api/account/avatar", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(3 * 1024 * 1024),
        },
        body: "x",
      }),
    ),
    (error) => error.status === 413,
  );
});
test("network limits trust only the configured proxy and group IPv6 interface rotations", () => {
  const header = (ip) => new Headers({ "x-forwarded-for": ip });
  assert.equal(clientAddress(header("203.0.113.2"), {}), "shared");
  assert.equal(
    clientAddress(header("203.0.113.2"), { VERCEL: "1" }),
    "203.0.113.2",
  );
  assert.equal(clientAddress(header("spoofed"), { VERCEL: "1" }), "unknown");
  assert.equal(
    clientAddress(header("::ffff:203.0.113.2"), { VERCEL: "1" }),
    "203.0.113.2",
  );
  assert.equal(
    clientAddress(header("2001:db8::1"), { VERCEL: "1" }),
    clientAddress(header("2001:0db8:0:0:abcd:12:34:56"), { VERCEL: "1" }),
  );
  assert.notEqual(
    clientAddress(header("2001:db8:1::1"), { VERCEL: "1" }),
    clientAddress(header("2001:db8:2::1"), { VERCEL: "1" }),
  );
});
test("invalid preferences fall back safely and explicit picture settings retain device limits", () => {
  assert.deepEqual(parsePreferences("bad", null), {
    theme: "light",
    quality: "auto",
    autoplay: true,
  });
  assert.deepEqual(
    parsePreferences('{"quality":"saver","autoplay":false}', "dark"),
    { theme: "dark", quality: "saver", autoplay: false },
  );
  assert.equal(selectVideoCap({ quality: "saver", dpr: 2 }, "hero", 1000), 360);
  assert.equal(
    selectVideoCap({ quality: "high", dpr: 1, downlink: 2 }, "hero", 1000),
    2160,
  );
  assert.equal(
    selectVideoCap({ quality: "high", saveData: true, dpr: 2 }, "hero", 1000),
    360,
  );
});
