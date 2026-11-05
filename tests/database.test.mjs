import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";

global.mongoose = { conn: null, promise: null };
const { connectToDatabase } = await import("../lib/db.ts");

test("database connection retries after failure and preserves the original error", async (t) => {
    const originalUri = process.env.REELOGRAM_MONGODB_URL;
    t.after(() => {
        if (originalUri === undefined) delete process.env.REELOGRAM_MONGODB_URL;
        else process.env.REELOGRAM_MONGODB_URL = originalUri;
        global.mongoose.conn = null;
        global.mongoose.promise = null;
    });
    process.env.REELOGRAM_MONGODB_URL = "mongodb://localhost/test";
    const failure = new Error("Connection failed");
    const connect = t.mock.method(mongoose, "connect", async () => { throw failure; });
    await assert.rejects(connectToDatabase(), (error) => error === failure);
    assert.equal(global.mongoose.promise, null);
    connect.mock.mockImplementation(async () => mongoose);
    const [first, second] = await Promise.all([connectToDatabase(), connectToDatabase()]);
    assert.equal(first, mongoose.connection);
    assert.equal(second, first);
    assert.equal(connect.mock.callCount(), 2);
});

test("validates missing configuration when connecting rather than importing", async () => {
    const originalUri = process.env.REELOGRAM_MONGODB_URL;
    delete process.env.REELOGRAM_MONGODB_URL;
    try {
        await assert.rejects(connectToDatabase(), /REELOGRAM_MONGODB_URL is not configured/);
    } finally {
        if (originalUri !== undefined) process.env.REELOGRAM_MONGODB_URL = originalUri;
    }
});

test("reuses an established connection", async (t) => {
    const connection = { readyState: 1 };
    global.mongoose.conn = connection;
    const connect = t.mock.method(mongoose, "connect", () => { throw new Error("Must reuse cached connection"); });
    try {
        assert.equal(await connectToDatabase(), connection);
        assert.equal(connect.mock.callCount(), 0);
    } finally {
        global.mongoose.conn = null;
        global.mongoose.promise = null;
    }
});
