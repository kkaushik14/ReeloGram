import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVideoInput, parseFeedQuery } from "../lib/video-input.ts";

const valid = { title: " Test ", description: " Description ", fileId: "video-id", thumbnailFileId: "thumbnail-id" };
test("video input trims text, preserves controls=false and excludes client-supplied author/URLs", () => {
    assert.deepEqual(parseVideoInput({ ...valid, controls: false, uploadedBy: "someone-else", videoUrl: "https://example.com/fake" }), {
        title: "Test", description: "Description", fileId: "video-id", thumbnailFileId: "thumbnail-id", controls: false,
    });
    assert.equal(parseVideoInput(valid).controls, true);
});

test("video input rejects malformed fields and oversized text", () => {
    for (const data of [null, {}, { ...valid, title: " " }, { ...valid, title: "a".repeat(121) },
        { ...valid, description: "a".repeat(2001) }, { ...valid, fileId: { $ne: null } },
        { ...valid, fileId: "../../files" }, { ...valid, thumbnailFileId: "" }, { ...valid, controls: "false" }]) {
        assert.equal(parseVideoInput(data), null);
    }
});

test("feed pagination is bounded and cursor values cannot become query operators", () => {
    assert.equal(parseFeedQuery(new URLSearchParams()).limit, 20);
    for (const query of ["limit=0", "limit=101", "limit=-1", "limit=1.5", "limit=abc", "cursor=bad", "cursor="]) {
        assert.equal(parseFeedQuery(new URLSearchParams(query)), null);
    }
    const createdAt = new Date().toISOString();
    const cursor = Buffer.from(JSON.stringify({ id: "a".repeat(24), createdAt })).toString("base64url");
    assert.deepEqual(parseFeedQuery(new URLSearchParams({ limit: "1", cursor })), {
        limit: 1, cursor: { id: "a".repeat(24), createdAt: new Date(createdAt) },
    });
    const operator = Buffer.from(JSON.stringify({ id: { $ne: null }, createdAt })).toString("base64url");
    assert.equal(parseFeedQuery(new URLSearchParams({ cursor: operator })), null);
});
