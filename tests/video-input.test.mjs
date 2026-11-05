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
    assert.equal(parseFeedQuery(new URLSearchParams()).limit, 5);
    for (const query of ["limit=0", "limit=6", "limit=101", "limit=-1", "limit=1.5", "limit=abc", "cursor=bad", "cursor="]) {
        assert.equal(parseFeedQuery(new URLSearchParams(query)), null);
    }
    const createdAt = new Date().toISOString();
    const cursor = Buffer.from(JSON.stringify({ id: "a".repeat(24), createdAt })).toString("base64url");
    assert.deepEqual(parseFeedQuery(new URLSearchParams({ limit: "1", cursor })), {
        limit: 1, q: "", sort: "newest", period: "any", mine: false, source: "all", context: JSON.stringify(["", "newest", "any", "false", "all"]), cursor: { id: "a".repeat(24), createdAt: new Date(createdAt) },
    });
    assert.equal(parseFeedQuery(new URLSearchParams({limit:"5",cursor})).limit,1);
    assert.equal(parseFeedQuery(new URLSearchParams({cursor})).limit,1);
    const operator = Buffer.from(JSON.stringify({ id: { $ne: null }, createdAt })).toString("base64url");
    assert.equal(parseFeedQuery(new URLSearchParams({ cursor: operator })), null);
});

test("feed filters are validated and cannot reuse another filter’s cursor", () => {
    for (const value of ["source=unknown", "sort=popular", "period=tomorrow", "mine=other", "q=" + "x".repeat(161)]) assert.equal(parseFeedQuery(new URLSearchParams(value)), null);
    assert.equal(parseFeedQuery(new URLSearchParams("q=%20Hello%20" )).q, "hello");
    const cursor = Buffer.from(JSON.stringify({id:"a".repeat(24), createdAt:new Date().toISOString(), context:JSON.stringify(["", "oldest", "any", "false", "all"])})).toString("base64url");
    assert.equal(parseFeedQuery(new URLSearchParams({cursor})), null);
    assert.ok(parseFeedQuery(new URLSearchParams({cursor,sort:"oldest"})));
});


test("long Unicode search terms survive cursor pagination", () => {
    const q = "水".repeat(160);
    const query = parseFeedQuery(new URLSearchParams({q}));
    const cursor = Buffer.from(JSON.stringify({id: "a".repeat(24), createdAt: new Date().toISOString(), context: query.context})).toString("base64url");
    assert.ok(parseFeedQuery(new URLSearchParams({q, cursor})));
});


test("all featured providers are valid and have isolated cursors", () => {
    for (const source of ["pexels","pixabay","coverr","mixkit"]) {
        const parsed = parseFeedQuery(new URLSearchParams({source}));
        assert.equal(parsed.source,source);
        const cursor = Buffer.from(JSON.stringify({id:"a".repeat(24),createdAt:new Date().toISOString(),context:parsed.context})).toString("base64url");
        assert.ok(parseFeedQuery(new URLSearchParams({source,cursor})));
        assert.equal(parseFeedQuery(new URLSearchParams({source:"community",cursor})),null);
    }
});
