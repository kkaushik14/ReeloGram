import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVideoUpdate } from "../lib/video-input.ts";
import { deleteMediaFile } from "../lib/video-media.ts";

test("partial edits preserve false, trim text, and forbid ownership or media changes", () => {
    assert.deepEqual(parseVideoUpdate({ title: " Title ", controls: false }), { title: "Title", controls: false });
    for (const value of [null, [], {}, { uploadedBy: "other" }, { fileId: "replacement" },
        { title: " " }, { description: "x".repeat(2001) }, { controls: "true" }, { $set: { title: "x" } }]) {
        assert.equal(parseVideoUpdate(value), null);
    }
});

test("ImageKit deletion treats missing files as cleaned up but preserves service failures for retry", async (t) => {
    const previous = process.env.PRIVATE_KEY;
    process.env.PRIVATE_KEY = "test-only-key";
    t.after(() => { if (previous === undefined) delete process.env.PRIVATE_KEY; else process.env.PRIVATE_KEY = previous; });
    const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
    await deleteMediaFile("already-deleted");
    fetch.mock.mockImplementation(async () => new Response(null, { status: 503 }));
    await assert.rejects(deleteMediaFile("retry-later"), /cleanup failed/);
});
