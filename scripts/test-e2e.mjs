import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile, rm } from "node:fs/promises";
import { MongoMemoryServer } from "mongodb-memory-server";
import ImageKit from "imagekit";
import { fixtures } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
nextRequire("@next/env").loadEnvConfig(process.cwd());

// Opt in to real service writes. Only files created by this run are deleted.
const liveUploads = process.argv.includes("--imagekit");
const configuredDatabase = process.argv.includes("--configured-db");
if (configuredDatabase) assert.ok(process.env.MONGODB_URL, "MONGODB_URL must be configured");
if (liveUploads) {
    for (const key of ["NEXT_PUBLIC_PUBLIC_KEY", "PRIVATE_KEY", "NEXT_PUBLIC_URL_ENDPOINT"]) {
        assert.ok(process.env[key], `${key} must be configured for live upload tests`);
    }
}

const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
const runId = randomUUID();
const email = `e2e-${runId}@example.invalid`;
const otherEmail = `e2e-other-${runId}@example.invalid`;
const password = randomBytes(24).toString("hex");
const cookies = new Map();
const uploaded = [];
let database;
let server;
let serverExit;
let checks = 0;
let databaseUri;
let registrationAttempted = false;

async function request(path, { data, form, anonymous = false, expected = 200, method } = {}) {
    const headers = {};
    if (!anonymous) headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (data) headers["Content-Type"] = "application/json";
    if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const response = await fetch(base + path, {
        method: method ?? (data || form ? "POST" : "GET"),
        headers,
        body: data ? JSON.stringify(data) : form ? new URLSearchParams(form) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
    });
    if (!anonymous) {
        for (const cookie of response.headers.getSetCookie()) {
            const [pair] = cookie.split(";");
            const separator = pair.indexOf("=");
            cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
    }
    assert.equal(response.status, expected, `${path} HTTP status`);
    checks++;
    return response;
}

async function signIn(input, expected = 200) {
    const { csrfToken } = await (await request("/api/auth/csrf")).json();
    return request("/api/auth/callback/credentials", {
        form: { csrfToken, email: input.email, password: input.password, json: "true" }, expected,
    });
}

try {
    await writeFile(".e2e.tsconfig.json", JSON.stringify({ extends: "./tsconfig.json" }));
    if (!configuredDatabase) {
        database = await MongoMemoryServer.create({ instance: { dbName: "reelogram_e2e" },
            binary: { downloadDir: join(tmpdir(), "reelogram-mongodb-binaries") } });
    }
    databaseUri = configuredDatabase ? process.env.MONGODB_URL : database.getUri();
    let ready = false;
    server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
        env: { ...process.env, PATH: dirname(process.execPath) + ":" + process.env.PATH,
            MONGODB_URL: databaseUri, NEXTAUTH_URL: base, NEXTAUTH_SECRET: randomBytes(32).toString("hex"),
            E2E_DIST_DIR: ".next-e2e" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    serverExit = once(server, "exit");
    server.stdout.on("data", (chunk) => { if (chunk.toString().includes("Ready in")) ready = true; });
    // Drain output without printing sessions, signatures or service configuration.
    server.stderr.resume();
    const deadline = Date.now() + 60000;
    while (!ready) {
        assert.equal(server.exitCode, null, "Test app exited before becoming ready");
        assert.ok(Date.now() < deadline, "Test app startup timed out");
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    console.log(`${configuredDatabase ? "Configured MongoDB" : "Disposable MongoDB"} and isolated Next.js server ready.`);

    await request("/register");
    await request("/login");
    await request("/api/imagekit-auth", { anonymous: true, expected: 401 });
    await request("/api/videos", { anonymous: true, data: { title: "Unauthorized" }, expected: 401 });
    await request("/api/videos?limit=0", { anonymous: true, expected: 400 });
    await request("/api/videos?cursor=invalid", { anonymous: true, expected: 400 });
    await request("/api/videos?mine=true", { anonymous: true, expected: 401 });
    const initialFeed = await (await request("/api/videos", { anonymous: true })).json();
    assert.ok(Array.isArray(initialFeed.videos));
    if (!configuredDatabase) assert.deepEqual(initialFeed, { videos: [], nextCursor: null });
    registrationAttempted = true;
    const attempts = await Promise.all([email, email.toUpperCase()].map((address) =>
        fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: address, password }), signal: AbortSignal.timeout(30000) })));
    assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 409], "Concurrent registration must create exactly one account");
    checks += 2;
    await request("/api/auth/register", { data: { email: email.toUpperCase(), password }, expected: 409 });
    const mongoose = (await import("mongoose")).default;
    const connection = await mongoose.createConnection(databaseUri, { serverSelectionTimeoutMS: 10000 }).asPromise();
    try {
        const stored = await connection.collection("users").findOne({ email });
        assert.equal(await connection.collection("users").countDocuments({ email }), 1);
        assert.ok(stored, "Registration must persist a user");
        assert.notEqual(stored.password, password, "Password must not be stored in plain text");
        const bcrypt = (await import("bcryptjs")).default;
        assert.ok(await bcrypt.compare(password, stored.password), "Stored password hash must verify");
    } finally {
        await connection.close();
    }
    await signIn({ email, password: "wrong-password" }, 401);
    assert.deepEqual(await (await request("/api/auth/session")).json(), {});
    await signIn({ email: email.toUpperCase(), password });
    const session = await (await request("/api/auth/session")).json();
    assert.equal(session.user.email, email);
    assert.ok(session.user.id);
    console.log("Registration, duplicate email, hashing, wrong password and session checks passed.");
    await request("/api/videos", { data: { title: "Missing upload" }, expected: 400 });

    if (liveUploads) {
        const mediaLibrary = new ImageKit({ publicKey: process.env.NEXT_PUBLIC_PUBLIC_KEY,
            privateKey: process.env.PRIVATE_KEY, urlEndpoint: process.env.NEXT_PUBLIC_URL_ENDPOINT });
        let thumbnailFile;
        const savedVideos = [];
        const videoFixture = fixtures.find((fixture) => fixture.type.startsWith("video/"));
        for (const fixture of [...fixtures, { ...videoFixture, name: "second-frame.avi" }]) {
            const authResponse = await request("/api/imagekit-auth");
            assert.match(authResponse.headers.get("cache-control"), /no-store/);
            const auth = await authResponse.json();
            assert.ok(auth.expire > Date.now() / 1000);
            const form = new FormData();
            form.set("file", new Blob([fixture.bytes], { type: fixture.type }), fixture.name);
            form.set("fileName", `e2e-${runId}-${fixture.name}`);
            form.set("folder", fixture.folder);
            form.set("publicKey", process.env.NEXT_PUBLIC_PUBLIC_KEY);
            for (const key of ["token", "expire", "signature"]) form.set(key, String(auth[key]));
            const upload = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
                method: "POST", body: form, signal: AbortSignal.timeout(60000),
            });
            const result = await upload.json();
            if (result.fileId) uploaded.push(result.fileId);
            assert.equal(upload.status, 200, `ImageKit ${fixture.type} upload HTTP status`);
            assert.ok(result.fileId);
            assert.ok(result.name.startsWith(`e2e-${runId}-`));
            const download = await fetch(result.url, { signal: AbortSignal.timeout(30000) });
            assert.equal(download.status, 200, "Uploaded file must be retrievable");
            assert.equal((await download.arrayBuffer()).byteLength, fixture.bytes.length);
            checks += 3;
            console.log(`Live ImageKit ${fixture.type} upload and retrieval passed.`);
            if (fixture.type === "image/png") thumbnailFile = result;
            if (fixture.type.startsWith("video/")) {
                const input = { title: `e2e-${runId}-${savedVideos.length}`, description: "Synthetic E2E video",
                    fileId: result.fileId, thumbnailFileId: thumbnailFile.fileId, controls: false,
                    uploadedBy: "forged-author", videoUrl: "https://example.invalid/forged.avi" };
                const saved = await (await request("/api/videos", { data: input, expected: 201 })).json();
                const verifiedVideo = await mediaLibrary.getFileDetails(result.fileId);
                const verifiedThumbnail = await mediaLibrary.getFileDetails(thumbnailFile.fileId);
                assert.equal(saved.videoUrl, verifiedVideo.url);
                assert.equal(saved.thumbnailUrl, verifiedThumbnail.url);
                assert.equal(saved.uploadedBy, session.user.id);
                assert.equal(saved.controls, false);
                savedVideos.push(saved);
                assert.equal((await (await request(`/api/videos/${saved.id}`, { anonymous: true })).json()).id, saved.id);
                await request("/api/videos", { data: input, expected: 409 });
                const db = await mongoose.createConnection(databaseUri).asPromise();
                try {
                    const stored = await db.collection("videos").findOne({ fileId: result.fileId });
                    assert.equal(stored._id.toString(), saved.id);
                    assert.equal(stored.uploadedBy.toString(), session.user.id);
                    assert.equal(stored.videoUrl, verifiedVideo.url);
                } finally { await db.close(); }
            }
        }
        await request("/api/videos", { data: { title: "Not a video", description: "Invalid media",
            fileId: thumbnailFile.fileId, thumbnailFileId: thumbnailFile.fileId }, expected: 400 });
        await request("/api/videos", { data: { title: "Missing file", description: "Missing media",
            fileId: "000000000000000000000000", thumbnailFileId: thumbnailFile.fileId }, expected: 404 });
        const firstResponse = await request("/api/videos?limit=1", { anonymous: true });
        assert.match(firstResponse.headers.get("cache-control"), /no-store/);
        const first = await firstResponse.json();
        assert.equal(first.videos[0].id, savedVideos[1].id);
        assert.ok(first.nextCursor);
        const second = await (await request(`/api/videos?limit=1&cursor=${first.nextCursor}`, { anonymous: true })).json();
        assert.equal(second.videos[0].id, savedVideos[0].id);
        if (!configuredDatabase) assert.equal(second.nextCursor, null);
        console.log("Video persistence, author attribution, duplicate rejection, media validation and public feed pagination passed.");

        const personal = await (await request("/api/videos?mine=true")).json();
        assert.ok(personal.videos.every((video) => video.uploadedBy === session.user.id));
        const target = `/api/videos/${savedVideos[0].id}`;
        await request(target, { anonymous: true, method: "PATCH", data: { title: "Forbidden" }, expected: 401 });
        await request(target, { anonymous: true, method: "DELETE", expected: 401 });
        const ownerCookies = [...cookies];
        await request("/api/auth/register", { data: { email: otherEmail, password }, expected: 201 });
        await signIn({ email: otherEmail, password });
        assert.deepEqual((await (await request("/api/videos?mine=true")).json()).videos, []);
        await request(target, { method: "PATCH", data: { title: "Forbidden" }, expected: 403 });
        await request(target, { method: "DELETE", expected: 403 });
        cookies.clear();
        for (const [key, value] of ownerCookies) cookies.set(key, value);
        await request("/api/videos/not-an-id", { method: "DELETE", expected: 400 });
        await request("/api/videos/000000000000000000000000", { method: "DELETE", expected: 404 });
        await request(target, { method: "PATCH", data: { uploadedBy: session.user.id }, expected: 400 });
        await request(target, { method: "PATCH", data: { title: " " }, expected: 400 });
        const edited = await (await request(target, { method: "PATCH", data: {
            title: " Updated E2E title ", description: "Updated description", controls: true,
        } })).json();
        assert.equal(edited.title, "Updated E2E title");
        assert.equal(edited.uploadedBy, session.user.id);
        assert.equal(edited.controls, true);
        const updatedFeed = await (await request("/api/videos", { anonymous: true })).json();
        assert.equal(updatedFeed.videos.find((video) => video.id === edited.id).title, edited.title);

        const db = await mongoose.createConnection(databaseUri).asPromise();
        try {
            const locks = db.collection("video_asset_locks");
            await locks.insertOne({ _id: savedVideos[0].fileId, token: runId, expiresAt: new Date(Date.now() + 90000) });
            try { await request(target, { method: "DELETE", expected: 409 }); }
            finally { await locks.deleteOne({ _id: savedVideos[0].fileId, token: runId }); }
            assert.equal((await db.collection("videos").findOne({ fileId: savedVideos[0].fileId })).title, edited.title);
            await request(target, { method: "DELETE", expected: 204 });
            assert.equal(await db.collection("videos").findOne({ fileId: savedVideos[0].fileId }), null);
            await assert.rejects(mediaLibrary.getFileDetails(savedVideos[0].fileId), (error) => error.$ResponseMetadata?.statusCode === 404);
            await mediaLibrary.getFileDetails(thumbnailFile.fileId); // Still used by the second video.
            await request(target, { method: "DELETE", expected: 404 });

            // Simulate a worker stopping after deleting a file but before completing cleanup.
            const remaining = savedVideos[1];
            await mediaLibrary.deleteFile(remaining.fileId);
            await db.collection("videos").updateOne({ fileId: remaining.fileId }, { $set: { deletionPending: true } });
            const pendingFeed = await (await request("/api/videos", { anonymous: true })).json();
            assert.ok(!pendingFeed.videos.some((video) => video.id === remaining.id));
            await request(`/api/videos/${remaining.id}`, { method: "PATCH", data: { title: "Cannot edit pending deletion" }, expected: 409 });
            await request(`/api/videos/${remaining.id}`, { method: "DELETE", expected: 204 });
            await assert.rejects(mediaLibrary.getFileDetails(thumbnailFile.fileId), (error) => error.$ResponseMetadata?.statusCode === 404);
            assert.equal(await db.collection("videos").countDocuments({ fileId: { $in: savedVideos.map((video) => video.fileId) } }), 0);
        } finally { await db.close(); }
        console.log("Owner-only edits/deletes, shared-thumbnail retention, ImageKit removal, lock contention and partial-delete retry passed.");
    } else {
        console.log("Live ImageKit uploads skipped. Enable explicitly with: npm run test:e2e -- --imagekit");
    }

    const { csrfToken } = await (await request("/api/auth/csrf")).json();
    await request("/api/auth/signout", { form: { csrfToken, json: "true" } });
    assert.deepEqual(await (await request("/api/auth/session")).json(), {});
    await request("/api/imagekit-auth", { expected: 401 });
    await request("/api/videos", { data: { title: "Logged out" }, expected: 401 });
    if (process.argv.includes("--hold")) {
        console.log(`Browser test server: ${base} (runner PID ${process.pid}). Send SIGINT to finish and clean up.`);
        await once(process, "SIGINT");
    }
    if (!configuredDatabase) {
        await database.stop();
        const failure = await signIn({ email, password }, 401);
        const { url } = await failure.json();
        assert.equal(new URL(url).searchParams.get("error"), "Sign-in is temporarily unavailable. Please try again later.");
        await request("/api/auth/register", { data: { email: `offline-${email}`, password }, expected: 503 });
        await request("/api/videos", { anonymous: true, expected: 503 });
        console.log("Database outage returns controlled errors without exposing connection details.");
    }
    console.log(`PASS: ${checks} end-to-end checks, including logout and upload access control.`);
} catch (error) {
    console.error("E2E failed:", error.message);
    process.exitCode = 1;
} finally {
    if (uploaded.length) {
        const imagekit = new ImageKit({ publicKey: process.env.NEXT_PUBLIC_PUBLIC_KEY,
            privateKey: process.env.PRIVATE_KEY, urlEndpoint: process.env.NEXT_PUBLIC_URL_ENDPOINT });
        for (const fileId of uploaded) {
            try {
                await imagekit.deleteFile(fileId);
                console.log("Deleted test upload.");
            } catch (error) {
                if (error.$ResponseMetadata?.statusCode === 404) continue;
                console.error("Could not delete test upload:", fileId);
                process.exitCode = 1;
            }
        }
    }
    if (server && server.exitCode === null) {
        server.kill("SIGTERM");
        const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
        await serverExit;
        clearTimeout(timer);
    }
    if (database) await database.stop();
    if (configuredDatabase && registrationAttempted) {
        let connection;
        try {
            const mongoose = (await import("mongoose")).default;
            connection = await mongoose.createConnection(databaseUri, { serverSelectionTimeoutMS: 10000 }).asPromise();
            await connection.collection("videos").deleteMany({ fileId: { $in: uploaded } });
            assert.equal(await connection.collection("videos").countDocuments({ fileId: { $in: uploaded } }), 0);
            await connection.collection("users").deleteMany({ email: { $in: [email, otherEmail] } });
            assert.equal(await connection.collection("users").countDocuments({ email: { $in: [email, otherEmail] } }), 0);
            console.log("Deleted this run's test account and video records from the configured database.");
        } catch {
            console.error("Could not clean up test account:", email);
            process.exitCode = 1;
        } finally {
            if (connection) await connection.close();
        }
    }
    await rm(".e2e.tsconfig.json", { force: true });
}
