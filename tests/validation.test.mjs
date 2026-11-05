import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCredentials } from "../lib/credentials.ts";
import { UPLOAD_OPTIONS, validateUpload } from "../lib/upload-validation.ts";

test("normalizes email without modifying the password", () => {
    assert.deepEqual(parseCredentials({ email: " Test@Example.COM ", password: " secret " }), {
        email: "test@example.com", password: " secret ",
    });
});

test("rejects malformed credentials and query operators", () => {
    for (const value of [null, [], {}, { email: { $ne: null }, password: "password" },
        { email: "invalid", password: "password" }, { email: "a@b.com", password: "" },
        { email: "a@b.com", password: "é".repeat(37) }]) {
        assert.equal(parseCredentials(value), null);
    }
    assert.ok(parseCredentials({ email: "a@b.com", password: "é".repeat(36) }));
});

test("allows valid images, videos and PDFs at the size boundary", () => {
    for (const [kind, type] of [["image", "image/jpeg"], ["image", "image/png"],
        ["image", "image/webp"], ["video", "video/mp4"], ["pdf", "application/pdf"]]) {
        assert.equal(validateUpload({ type, size: UPLOAD_OPTIONS[kind].maxSize }, kind), null);
        assert.ok(validateUpload({ type, size: UPLOAD_OPTIONS[kind].maxSize + 1 }, kind));
        assert.ok(validateUpload({ type, size: 0 }, kind));
    }
});

test("rejects mismatched media types", () => {
    assert.ok(validateUpload({ type: "application/pdf", size: 100 }, "image"));
    assert.ok(validateUpload({ type: "image/png", size: 100 }, "video"));
    assert.ok(validateUpload({ type: "image/png", size: 100 }, "pdf"));
    assert.ok(validateUpload({ type: "image/svg+xml", size: 100 }, "image"));
});
