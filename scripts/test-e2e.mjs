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
import { startEmailTestServer, emailBody } from "./email-test-server.mjs";
import { fixtures } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
nextRequire("@next/env").loadEnvConfig(process.cwd());

// Opt in to real service writes. Only files created by this run are deleted.
const liveUploads = process.argv.includes("--imagekit");
const configuredDatabase = process.argv.includes("--configured-db");
if (configuredDatabase)
  assert.ok(
    process.env.REELOGRAM_MONGODB_URL,
    "REELOGRAM_MONGODB_URL must be configured",
  );
if (liveUploads) {
  for (const key of [
    "REELOGRAM_NEXT_PUBLIC_PUBLIC_KEY",
    "REELOGRAM_PRIVATE_KEY",
    "REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT",
  ]) {
    assert.ok(
      process.env[key],
      `${key} must be configured for live upload tests`,
    );
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
let mail;

async function request(
  path,
  { data, form, multipart, anonymous = false, expected = 200, method } = {},
) {
  const headers = {};
  if (!anonymous)
    headers.Cookie = [...cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  if (data) headers["Content-Type"] = "application/json";
  if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const response = await fetch(base + path, {
    method: method ?? (data || form || multipart ? "POST" : "GET"),
    headers,
    body: data
      ? JSON.stringify(data)
      : form
        ? new URLSearchParams(form)
        : multipart,
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

async function waitEmail(subject, offset = 0) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const found = mail.messages
      .slice(offset)
      .find((message) => emailBody(message.raw).includes(subject));
    if (found) return emailBody(found.raw);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Expected transactional email was not delivered: ${subject}`);
}
async function signIn(input, expected = 200) {
  const { csrfToken } = await (await request("/api/auth/csrf")).json();
  const response = await request("/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email: input.email,
      password: input.password,
      json: "true",
    },
    expected,
  });
  const result = await response.clone().json();
  assert.equal(
    new URL(result.url).origin,
    base,
    "NextAuth must use the namespaced canonical URL",
  );
  return response;
}

async function assertAuthRedirect(path, destination = "/") {
  const response = await fetch(base + path, {
    headers: { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
    redirect: "manual",
  });
  if (response.status === 307) {
    assert.equal(new URL(response.headers.get("location"), base).href, base + destination);
  } else {
    // Next.js may have started streaming the route skeleton before checking the session.
    assert.equal(response.status, 200);
    const html = await response.text();
    const refresh = html.match(/http-equiv="refresh" content="[01];url=([^"]*)"/);
    assert.ok(refresh, `${path} must redirect an existing session`);
    assert.equal(new URL(refresh[1].replace(/&amp;/g, "&"), base).href, base + destination);
  }
  checks++;
}

try {
  mail = await startEmailTestServer();
  await writeFile(
    ".e2e.tsconfig.json",
    JSON.stringify({ extends: "./tsconfig.json" }),
  );
  if (!configuredDatabase) {
    database = await MongoMemoryServer.create({
      instance: { dbName: "reelogram_e2e" },
      binary: { downloadDir: join(tmpdir(), "reelogram-mongodb-binaries") },
    });
  }
  databaseUri = configuredDatabase
    ? process.env.REELOGRAM_MONGODB_URL
    : database.getUri();
  let ready = false;
  server = spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: {
        ...process.env,
        ...mail.env,
        REELOGRAM_APP_URL: base,
        PATH: dirname(process.execPath) + ":" + process.env.PATH,
        REELOGRAM_MONGODB_URL: databaseUri,
        REELOGRAM_NEXTAUTH_URL: base,
        REELOGRAM_NEXTAUTH_SECRET: randomBytes(32).toString("hex"),
        REELOGRAM_E2E_DIST_DIR: ".next-e2e",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  serverExit = once(server, "exit");
  server.stdout.on("data", (chunk) => {
    if (chunk.toString().includes("Ready in")) ready = true;
  });
  // Drain output without printing sessions, signatures or service configuration.
  server.stderr.resume();
  const deadline = Date.now() + 60000;
  while (!ready) {
    assert.equal(
      server.exitCode,
      null,
      "Test app exited before becoming ready",
    );
    assert.ok(Date.now() < deadline, "Test app startup timed out");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(
    `${configuredDatabase ? "Configured MongoDB" : "Disposable MongoDB"} and isolated Next.js server ready.`,
  );

  await request("/register");
  await request("/login");
  await request("/api/imagekit-auth", { anonymous: true, expected: 401 });
  await request("/api/account",{anonymous:true,expected:401});
  await request("/api/account/avatar",{anonymous:true,method:"DELETE",expected:401});
  await request("/api/videos", {
    anonymous: true,
    data: { title: "Unauthorized" },
    expected: 401,
  });
  await request("/api/videos?limit=0", { anonymous: true, expected: 400 });
  await request("/api/videos?cursor=invalid", {
    anonymous: true,
    expected: 400,
  });
  await request("/api/videos?mine=true", { anonymous: true, expected: 401 });
  const initialFeed = await (
    await request("/api/videos", { anonymous: true })
  ).json();
  assert.ok(Array.isArray(initialFeed.videos));
  if (!configuredDatabase)
    assert.deepEqual(initialFeed, { videos: [], nextCursor: null, total: 0 });
  registrationAttempted = true;
  const attempts = await Promise.all(
    [email, email.toUpperCase()].map((address) =>
      fetch(base + "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: address,
          password,
          name: "  Video   Creator  ",
          dateOfBirth: "1998-01-23",
        }),
        signal: AbortSignal.timeout(30000),
      }),
    ),
  );
  assert.deepEqual(
    attempts.map((response) => response.status).sort(),
    [201, 409],
    "Concurrent registration must create exactly one account",
  );
  checks += 2;
  const signupHandoff = await attempts
    .find((response) => response.status === 201)
    .json();
  assert.match(signupHandoff.signInToken, /^[A-Za-z0-9_-]{43}$/);
  await request("/api/auth/register", {
    data: {
      email: email.toUpperCase(),
      password,
      name: "Video Creator",
      dateOfBirth: "1998-01-23",
    },
    expected: 409,
  });
  const mongoose = (await import("mongoose")).default;
  const connection = await mongoose
    .createConnection(databaseUri, { serverSelectionTimeoutMS: 10000 })
    .asPromise();
  try {
    const stored = await connection.collection("users").findOne({ email });
    assert.equal(
      await connection.collection("users").countDocuments({ email }),
      1,
    );
    assert.ok(stored, "Registration must persist a user");
    assert.notEqual(
      stored.password,
      password,
      "Password must not be stored in plain text",
    );
    const bcrypt = (await import("bcryptjs")).default;
    assert.ok(
      await bcrypt.compare(password, stored.password),
      "Stored password hash must verify",
    );
  } finally {
    await connection.close();
  }
  const completeSignIn = async (email, completionToken, expected = 200) => {
    const { csrfToken } = await (await request("/api/auth/csrf")).json();
    return request("/api/auth/callback/credentials", {
      form: { csrfToken, email, completionToken, json: "true" },
      expected,
    });
  };
  await completeSignIn(`wrong-${email}`, signupHandoff.signInToken, 401);
  await completeSignIn(email, signupHandoff.signInToken);
  assert.equal(
    (await (await request("/api/auth/session")).json()).user.email,
    email,
  );
  await completeSignIn(email, signupHandoff.signInToken, 401);
  const signupCsrf = await (await request("/api/auth/csrf")).json();
  await request("/api/auth/signout", {
    form: { csrfToken: signupCsrf.csrfToken, json: "true" },
  });
  await signIn({ email, password: "wrong-password" }, 401);
  assert.deepEqual(await (await request("/api/auth/session")).json(), {});
  await signIn({
    email: email.toUpperCase(),
    password,
    name: "Video Creator",
    dateOfBirth: "1998-01-23",
  });
  const session = await (await request("/api/auth/session")).json();
  assert.equal(session.user.email, email);
  assert.equal(session.user.name, "Video Creator");
  assert.ok(session.user.id);
  const privateProfile=await request("/api/account");
  assert.match(privateProfile.headers.get("cache-control"),/no-store/);
  const profile=await privateProfile.json();
  assert.equal(profile.name,"Video Creator");assert.equal(profile.email,email);assert.equal(profile.dateOfBirth,"1998-01-23");
  assert.ok(!("password" in profile));assert.ok(!("imageFileId" in profile));
  await request("/api/account",{method:"PATCH",data:{name:"Changed",dateOfBirth:"2000-01-01",email:otherEmail},expected:405});
  assert.equal((await(await request("/api/account?userId=000000000000000000000000")).json()).email,email);
  await request("/api/account/avatar",{data:{image:"https://untrusted.invalid/avatar.svg"},expected:415});
  const invalidPhoto=new FormData();invalidPhoto.set("file",new Blob(["not a real image"],{type:"image/png"}),"photo.png");
  await request("/api/account/avatar",{multipart:invalidPhoto,expected:400});
  await request("/email-logo.png", { anonymous: true });
  await assertAuthRedirect("/login");
  await assertAuthRedirect("/register");
  await assertAuthRedirect("/login?callbackUrl=%2Fmy-videos", "/my-videos");
  await assertAuthRedirect("/login?callbackUrl=https%3A%2F%2Funtrusted.invalid%2F");
  await assertAuthRedirect("/register?callbackUrl=%2F%256cogin");
  await waitEmail("Welcome to ReeloGram");
  assert.equal(
    (await (await request("/api/auth/identify", { data: { email } })).json())
      .next,
    "login",
  );
  assert.equal(
    (
      await (
        await request("/api/auth/identify", { data: { email: `new-${email}` } })
      ).json()
    ).next,
    "register",
  );
  for (const path of ["/api/auth/identify", "/api/auth/forgot-password"]) {
    await request(path, { data: { email: { $ne: null } }, expected: 400 });
  }
  await request("/api/auth/register", {
    data: {
      email: `bad-${email}`,
      password,
      name: "Bad date",
      dateOfBirth: "2026-02-31",
    },
    expected: 400,
  });
  await request("/api/auth/register", {
    data: {
      email: `bad-${email}`,
      password,
      name: "Future date",
      dateOfBirth: "2999-01-01",
    },
    expected: 400,
  });
  const foreign = await fetch(base + "/api/auth/identify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://untrusted.invalid",
    },
    body: JSON.stringify({ email }),
  });
  assert.equal(foreign.status, 403);
  checks++;
  console.log(
    "Registration, private profile fields, email-first routing, input validation, session and welcome email checks passed.",
  );
  await request("/api/videos", {
    data: { title: "Missing upload" },
    expected: 400,
  });

  if (liveUploads) {
    const mediaLibrary = new ImageKit({
      publicKey: process.env.REELOGRAM_NEXT_PUBLIC_PUBLIC_KEY,
      privateKey: process.env.REELOGRAM_PRIVATE_KEY,
      urlEndpoint: process.env.REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT,
    });
    const avatarBody=new FormData();
    const {default:sharp}=await import("sharp");
    const avatarBytes=await sharp({create:{width:32,height:32,channels:3,background:"#6A4D77"}}).png().toBuffer();
    avatarBody.set("file",new Blob([avatarBytes],{type:"image/png"}),"profile.png");
    await request("/api/account/avatar",{multipart:avatarBody});
    const avatarProfile=await(await request("/api/account")).json();
    assert.ok(avatarProfile.image.startsWith(process.env.REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT));
    const avatarDb=await mongoose.createConnection(databaseUri).asPromise();
    let avatarId;
    try{avatarId=(await avatarDb.collection("users").findOne({email})).imageFileId;}finally{await avatarDb.close();}
    uploaded.push(avatarId);
    assert.equal((await mediaLibrary.getFileDetails(avatarId)).mime,"image/webp");
    assert.equal((await(await request("/api/auth/session")).json()).user.image,avatarProfile.image);
    await request("/api/account/avatar",{method:"DELETE"});
    assert.equal((await(await request("/api/account")).json()).image,null);
    const cleanupDeadline=Date.now()+20000;
    let cleaned=false;
    while(Date.now()<cleanupDeadline){try{await mediaLibrary.getFileDetails(avatarId);}catch(error){if(error.$ResponseMetadata?.statusCode===404){cleaned=true;break;}throw error;}await new Promise(resolve=>setTimeout(resolve,200));}
    assert.ok(cleaned,"Removed profile photos must be cleaned from ImageKit");
    console.log("Private read-only profile, normalized ImageKit photo, session refresh and photo removal passed.");
    let thumbnailFile;
    const savedVideos = [];
    const videoFixture = fixtures.find((fixture) =>
      fixture.type.startsWith("video/"),
    );
    for (const fixture of [
      ...fixtures,
      { ...videoFixture, name: "second-frame.avi" },
    ]) {
      const authResponse = await request("/api/imagekit-auth");
      assert.match(authResponse.headers.get("cache-control"), /no-store/);
      const auth = await authResponse.json();
      assert.ok(auth.expire > Date.now() / 1000);
      const form = new FormData();
      form.set(
        "file",
        new Blob([fixture.bytes], { type: fixture.type }),
        fixture.name,
      );
      form.set("fileName", `e2e-${runId}-${fixture.name}`);
      form.set("folder", fixture.folder);
      form.set("publicKey", process.env.REELOGRAM_NEXT_PUBLIC_PUBLIC_KEY);
      for (const key of ["token", "expire", "signature"])
        form.set(key, String(auth[key]));
      const upload = await fetch(
        "https://upload.imagekit.io/api/v1/files/upload",
        {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(60000),
        },
      );
      const result = await upload.json();
      if (result.fileId) uploaded.push(result.fileId);
      assert.equal(
        upload.status,
        200,
        `ImageKit ${fixture.type} upload HTTP status`,
      );
      assert.ok(result.fileId);
      assert.ok(result.name.startsWith(`e2e-${runId}-`));
      const download = await fetch(result.url, {
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(download.status, 200, "Uploaded file must be retrievable");
      assert.equal(
        (await download.arrayBuffer()).byteLength,
        fixture.bytes.length,
      );
      checks += 3;
      console.log(`Live ImageKit ${fixture.type} upload and retrieval passed.`);
      if (fixture.type === "image/png") thumbnailFile = result;
      if (fixture.type.startsWith("video/")) {
        const input = {
          title: `e2e-${runId}-${savedVideos.length}`,
          description: "Synthetic E2E video",
          fileId: result.fileId,
          thumbnailFileId: thumbnailFile.fileId,
          controls: false,
          uploadedBy: "forged-author",
          videoUrl: "https://example.invalid/forged.avi",
        };
        const saved = await (
          await request("/api/videos", { data: input, expected: 201 })
        ).json();
        const verifiedVideo = await mediaLibrary.getFileDetails(result.fileId);
        const verifiedThumbnail = await mediaLibrary.getFileDetails(
          thumbnailFile.fileId,
        );
        assert.equal(saved.videoUrl, verifiedVideo.url);
        assert.equal(saved.thumbnailUrl, verifiedThumbnail.url);
        assert.equal(saved.uploadedBy, session.user.id);
        assert.equal(saved.uploader.name, "Video Creator");
        assert.equal(saved.uploader.id, session.user.id);
        assert.ok(
          !("email" in saved.uploader),
          "Public uploader must not expose an email",
        );
        assert.equal(saved.transformation.width, verifiedVideo.width || 1080);
        assert.equal(saved.transformation.height, verifiedVideo.height || 1920);
        assert.equal(saved.controls, false);
        assert.ok(!("dateOfBirth" in saved.uploader));
        await waitEmail("Your video is live on ReeloGram");
        savedVideos.push(saved);
        assert.equal(
          (
            await (
              await request(`/api/videos/${saved.id}`, { anonymous: true })
            ).json()
          ).id,
          saved.id,
        );
        await request("/api/videos", { data: input, expected: 409 });
        const db = await mongoose.createConnection(databaseUri).asPromise();
        try {
          const stored = await db
            .collection("videos")
            .findOne({ fileId: result.fileId });
          assert.equal(stored._id.toString(), saved.id);
          assert.equal(stored.uploadedBy.toString(), session.user.id);
          assert.equal(stored.videoUrl, verifiedVideo.url);
        } finally {
          await db.close();
        }
      }
    }
    await request("/api/videos", {
      data: {
        title: "Not a video",
        description: "Invalid media",
        fileId: thumbnailFile.fileId,
        thumbnailFileId: thumbnailFile.fileId,
      },
      expected: 400,
    });
    await request("/api/videos", {
      data: {
        title: "Missing file",
        description: "Missing media",
        fileId: "000000000000000000000000",
        thumbnailFileId: thumbnailFile.fileId,
      },
      expected: 404,
    });
    const firstResponse = await request("/api/videos?limit=1", {
      anonymous: true,
    });
    assert.match(firstResponse.headers.get("cache-control"), /no-store/);
    const first = await firstResponse.json();
    assert.equal(first.videos[0].id, savedVideos[1].id);
    assert.ok(first.nextCursor);
    const second = await (
      await request(`/api/videos?limit=1&cursor=${first.nextCursor}`, {
        anonymous: true,
      })
    ).json();
    assert.equal(second.videos[0].id, savedVideos[0].id);
    if (!configuredDatabase) assert.equal(second.nextCursor, null);
    console.log(
      "Video persistence, author attribution, duplicate rejection, media validation and public feed pagination passed.",
    );
    const sourceDb = await mongoose.createConnection(databaseUri).asPromise();
    try {
      for (const provider of ["Pexels", "Pixabay", "Coverr", "Mixkit"]) {
        await sourceDb.collection("videos").updateOne(
          { fileId: savedVideos[0].fileId },
          {
            $set: {
              source: {
                provider,
                id: `e2e-${runId}`,
                creator: `Credit ${runId}`,
                url: "https://www.pexels.com/videos/",
                license: "https://www.pexels.com/license/",
              },
            },
          },
        );
        const filtered = await (
          await request(
            `/api/videos?q=${runId}&source=${provider.toLowerCase()}`,
            { anonymous: true },
          )
        ).json();
        assert.equal(filtered.total, 1);
        assert.equal(filtered.videos[0].source.provider, provider);
        assert.equal(filtered.videos[0].source.creator, `Credit ${runId}`);
      }
      await sourceDb
        .collection("videos")
        .updateOne(
          { fileId: savedVideos[0].fileId },
          { $set: { placement: "hero" } },
        );
      const hiddenPreview = await (
        await request(`/api/videos?q=${runId}&source=mixkit`, {
          anonymous: true,
        })
      ).json();
      assert.equal(
        hiddenPreview.total,
        0,
        "Banner clips must not appear in the video feed",
      );
      const showcase = await (
        await request("/api/showcase", { anonymous: true })
      ).json();
      assert.ok(
        showcase.videos.some((video) => video.id === savedVideos[0].id),
      );
      await sourceDb
        .collection("videos")
        .updateOne(
          { fileId: savedVideos[0].fileId },
          { $set: { placement: "archived" } },
        );
      assert.equal(
        (
          await (
            await request(`/api/videos?q=${runId}&source=mixkit`, {
              anonymous: true,
            })
          ).json()
        ).total,
        0,
      );
      await request(`/api/videos/${savedVideos[0].id}`, {
        anonymous: true,
        expected: 404,
      });
      assert.ok(
        !(
          await (await request("/api/showcase", { anonymous: true })).json()
        ).videos.some((video) => video.id === savedVideos[0].id),
      );
      await sourceDb
        .collection("videos")
        .updateOne(
          { fileId: savedVideos[0].fileId },
          { $unset: { placement: "" } },
        );
      await sourceDb
        .collection("users")
        .updateOne(
          { _id: new mongoose.Types.ObjectId(session.user.id) },
          { $set: { image: thumbnailFile.url } },
        );
      const attributed = await (
        await request(`/api/videos/${savedVideos[1].id}`, { anonymous: true })
      ).json();
      assert.equal(attributed.uploader.image, thumbnailFile.url);
      assert.equal(attributed.uploader.name, "Video Creator");
      assert.ok(!("email" in attributed.uploader));
      const community = await (
        await request(`/api/videos?q=${runId}&source=community`, {
          anonymous: true,
        })
      ).json();
      assert.equal(community.total, 1);
      assert.equal(community.videos[0].id, savedVideos[1].id);
    } finally {
      await sourceDb
        .collection("videos")
        .updateOne(
          { fileId: savedVideos[0].fileId },
          { $unset: { source: "", placement: "" } },
        );
      await sourceDb.close();
    }

    const filterQuery = `q=${encodeURIComponent(runId)}`;
    const matching = await (
      await request(`/api/videos?${filterQuery}`, { anonymous: true })
    ).json();
    assert.equal(matching.total, 2);
    const ascending = await (
      await request(`/api/videos?${filterQuery}&sort=oldest&limit=1`, {
        anonymous: true,
      })
    ).json();
    assert.equal(ascending.videos[0].id, savedVideos[0].id);
    const ascendingNext = await (
      await request(
        `/api/videos?${filterQuery}&sort=oldest&limit=1&cursor=${ascending.nextCursor}`,
        { anonymous: true },
      )
    ).json();
    assert.equal(ascendingNext.videos[0].id, savedVideos[1].id);
    await request(`/api/videos?${filterQuery}&cursor=${ascending.nextCursor}`, {
      anonymous: true,
      expected: 400,
    });
    const literal = await (
      await request(`/api/videos?q=${encodeURIComponent(runId + ".*")}`, {
        anonymous: true,
      })
    ).json();
    assert.equal(literal.total, 0);
    const dates = await mongoose.createConnection(databaseUri).asPromise();
    try {
      await dates
        .collection("videos")
        .updateOne(
          { fileId: savedVideos[0].fileId },
          { $set: { createdAt: new Date(Date.now() - 45 * 86400000) } },
        );
      const recent = await (
        await request(`/api/videos?${filterQuery}&period=month`, {
          anonymous: true,
        })
      ).json();
      assert.equal(recent.total, 1);
      assert.equal(recent.videos[0].id, savedVideos[1].id);
      const year = await (
        await request(`/api/videos?${filterQuery}&period=year`, {
          anonymous: true,
        })
      ).json();
      assert.equal(year.total, 2);
    } finally {
      await dates
        .collection("videos")
        .updateOne(
          { fileId: savedVideos[0].fileId },
          { $set: { createdAt: new Date(savedVideos[0].createdAt) } },
        );
      await dates.close();
    }
    console.log(
      "Server-side search, literal escaping, date filters, ascending pagination and cursor isolation passed.",
    );

    const personal = await (await request("/api/videos?mine=true")).json();
    assert.ok(
      personal.videos.every((video) => video.uploadedBy === session.user.id),
    );
    const target = `/api/videos/${savedVideos[0].id}`;
    await request(target, {
      anonymous: true,
      method: "PATCH",
      data: { title: "Forbidden" },
      expected: 401,
    });
    await request(target, { anonymous: true, method: "DELETE", expected: 401 });
    const ownerCookies = [...cookies];
    await request("/api/auth/register", {
      data: {
        email: otherEmail,
        password,
        name: "Other Creator",
        dateOfBirth: "1998-01-23",
      },
      expected: 201,
    });
    await signIn({
      email: otherEmail,
      password,
      name: "Other Creator",
      dateOfBirth: "1998-01-23",
    });
    assert.deepEqual(
      (await (await request("/api/videos?mine=true")).json()).videos,
      [],
    );
    await request(target, {
      method: "PATCH",
      data: { title: "Forbidden" },
      expected: 403,
    });
    await request(target, { method: "DELETE", expected: 403 });
    cookies.clear();
    for (const [key, value] of ownerCookies) cookies.set(key, value);
    await request("/api/videos/not-an-id", { method: "DELETE", expected: 400 });
    await request("/api/videos/000000000000000000000000", {
      method: "DELETE",
      expected: 404,
    });
    await request(target, {
      method: "PATCH",
      data: { uploadedBy: session.user.id },
      expected: 400,
    });
    await request(target, {
      method: "PATCH",
      data: { title: " " },
      expected: 400,
    });
    const edited = await (
      await request(target, {
        method: "PATCH",
        data: {
          title: " Updated E2E title ",
          description: "Updated description",
          controls: true,
        },
      })
    ).json();
    assert.equal(edited.title, "Updated E2E title");
    assert.equal(edited.uploadedBy, session.user.id);
    assert.equal(edited.controls, true);
    const updatedFeed = await (
      await request("/api/videos", { anonymous: true })
    ).json();
    assert.equal(
      updatedFeed.videos.find((video) => video.id === edited.id).title,
      edited.title,
    );

    const db = await mongoose.createConnection(databaseUri).asPromise();
    try {
      const locks = db.collection("video_asset_locks");
      await locks.insertOne({
        _id: savedVideos[0].fileId,
        token: runId,
        expiresAt: new Date(Date.now() + 90000),
      });
      try {
        await request(target, { method: "DELETE", expected: 409 });
      } finally {
        await locks.deleteOne({ _id: savedVideos[0].fileId, token: runId });
      }
      assert.equal(
        (
          await db
            .collection("videos")
            .findOne({ fileId: savedVideos[0].fileId })
        ).title,
        edited.title,
      );
      await request(target, { method: "DELETE", expected: 204 });
      assert.equal(
        await db
          .collection("videos")
          .findOne({ fileId: savedVideos[0].fileId }),
        null,
      );
      await assert.rejects(
        mediaLibrary.getFileDetails(savedVideos[0].fileId),
        (error) => error.$ResponseMetadata?.statusCode === 404,
      );
      await mediaLibrary.getFileDetails(thumbnailFile.fileId); // Still used by the second video.
      await request(target, { method: "DELETE", expected: 404 });

      // Simulate a worker stopping after deleting a file but before completing cleanup.
      const remaining = savedVideos[1];
      await mediaLibrary.deleteFile(remaining.fileId);
      await db
        .collection("videos")
        .updateOne(
          { fileId: remaining.fileId },
          { $set: { deletionPending: true } },
        );
      const pendingFeed = await (
        await request("/api/videos", { anonymous: true })
      ).json();
      assert.ok(!pendingFeed.videos.some((video) => video.id === remaining.id));
      await request(`/api/videos/${remaining.id}`, {
        method: "PATCH",
        data: { title: "Cannot edit pending deletion" },
        expected: 409,
      });
      await request(`/api/videos/${remaining.id}`, {
        method: "DELETE",
        expected: 204,
      });
      await assert.rejects(
        mediaLibrary.getFileDetails(thumbnailFile.fileId),
        (error) => error.$ResponseMetadata?.statusCode === 404,
      );
      assert.equal(
        await db.collection("videos").countDocuments({
          fileId: { $in: savedVideos.map((video) => video.fileId) },
        }),
        0,
      );
    } finally {
      await db.close();
    }
    console.log(
      "Owner-only edits/deletes, shared-thumbnail retention, ImageKit removal, lock contention and partial-delete retry passed.",
    );
  } else {
    console.log(
      "Live ImageKit uploads skipped. Enable explicitly with: npm run test:e2e -- --imagekit",
    );
  }

  if(liveUploads){
    const prior=[...cookies];
    await signIn({email:otherEmail,password});
    const cookie=[...cookies].map(([name,value])=>`${name}=${value}`).join("; ");
    const quota=await Promise.all(Array.from({length:21},()=>fetch(base+"/api/imagekit-auth",{headers:{Cookie:cookie}})));
    assert.equal(quota.filter(response=>response.status===200).length,20);
    assert.equal(quota.filter(response=>response.status===429).length,1);
    assert.ok(Number(quota.find(response=>response.status===429).headers.get("retry-after"))>0);
    checks+=21;
    cookies.clear();for(const [key,value]of prior)cookies.set(key,value);
    console.log("Upload authorization quota is atomic and returns 429 with Retry-After.");
  }

  const attemptsAtOnce = await Promise.all(
    Array.from({ length: 30 }, () =>
      fetch(base + "/api/auth/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `limit-${runId}@example.invalid` }),
      }),
    ),
  );
  assert.equal(
    attemptsAtOnce.filter((response) => response.status === 200).length,
    20,
  );
  assert.equal(
    attemptsAtOnce.filter((response) => response.status === 429).length,
    10,
  );
  checks += 30;
  const oversized = await fetch(base + "/api/auth/identify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, extra: "x".repeat(9000) }),
  });
  assert.equal(oversized.status, 413);
  checks++;
  const bearer = await fetch(base + "/api/imagekit-auth", {
    headers: { Authorization: "Bearer %invalid" },
  });
  assert.equal(bearer.status, 401);
  checks++;
  console.log(
    "Concurrent account throttling, bounded request bodies and malformed authorization checks passed.",
  );
  const recoveryDb = await (
    await import("mongoose")
  ).default
    .createConnection(databaseUri)
    .asPromise();
  try {
    const resetEmail = `reset-${runId}@example.invalid`;
    const profile = {
      email: resetEmail,
      password,
      name: "Reset Creator",
      dateOfBirth: "1995-06-15",
    };
    await request("/api/auth/register", { data: profile, expected: 201 });
    await signIn({ email: resetEmail, password });
    const authenticatedCookies = [...cookies];
    const baseline = mail.messages.length;
    const unknown = await (
      await request("/api/auth/forgot-password", {
        data: { email: `missing-${runId}@example.invalid` },
      })
    ).json();
    const known = await (
      await request("/api/auth/forgot-password", {
        data: { email: resetEmail },
      })
    ).json();
    assert.deepEqual(
      known,
      unknown,
      "Recovery must not disclose account existence",
    );
    const firstMail = await waitEmail(
      "Reset your ReeloGram password",
      baseline,
    );
    const token = firstMail.match(/#token=([A-Za-z0-9_-]{43})/)[1];
    const digest = (await import("node:crypto"))
      .createHash("sha256")
      .update(token)
      .digest("hex");
    const stored = await recoveryDb
      .collection("users")
      .findOne({ email: resetEmail });
    assert.equal(stored.passwordReset.digest, digest);
    assert.ok(!JSON.stringify(stored).includes(token));
    await request("/api/auth/reset-password", {
      data: { token, password },
      expected: 400,
    });
    await request("/api/auth/reset-password", {
      data: { token, password: "short" },
      expected: 400,
    });
    await recoveryDb
      .collection("users")
      .updateOne(
        { email: resetEmail },
        { $set: { "passwordReset.expiresAt": new Date(0) } },
      );
    await request("/api/auth/reset-password", {
      data: { token, password: password + "New" },
      expected: 400,
    });
    const nextBaseline = mail.messages.length;
    await request("/api/auth/forgot-password", { data: { email: resetEmail } });
    const nextMail = await waitEmail(
      "Reset your ReeloGram password",
      nextBaseline,
    );
    const nextToken = nextMail.match(/#token=([A-Za-z0-9_-]{43})/)[1];
    await request("/api/auth/reset-password", {
      data: { token, password: password + "New" },
      expected: 400,
    });
    const resets = await Promise.all(
      [1, 2].map(() =>
        fetch(base + "/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: nextToken,
            password: password + "New",
          }),
        }),
      ),
    );
    assert.deepEqual(
      resets.map((response) => response.status).sort(),
      [200, 400],
    );
    checks += 2;
    const resetHandoff = await resets
      .find((response) => response.status === 200)
      .json();
    await request("/api/auth/reset-password", {
      data: { token: nextToken, password: password + "Other" },
      expected: 400,
    });
    cookies.clear();
    for (const [key, value] of authenticatedCookies) cookies.set(key, value);
    assert.deepEqual(
      await (await request("/api/auth/session")).json(),
      {},
      "Password reset invalidates previous sessions",
    );
    await request("/api/imagekit-auth", { expected: 401 });
    await request("/api/account",{expected:401});
    await completeSignIn(resetEmail, resetHandoff.signInToken);
    assert.equal(
      (await (await request("/api/auth/session")).json()).user.email,
      resetEmail,
    );
    await completeSignIn(resetEmail, resetHandoff.signInToken, 401);

    await signIn({ email: resetEmail, password }, 401);
    await signIn({ email: resetEmail, password: password + "New" });
    const resetUser = await recoveryDb
      .collection("users")
      .findOne({ email: resetEmail });
    assert.equal(resetUser.sessionVersion, 1);
    assert.ok(!resetUser.passwordReset);
    await waitEmail("Your ReeloGram password was changed");
    await request("/api/auth/forgot-password", { data: { email: resetEmail } });
    const limited = await request("/api/auth/forgot-password", {
      data: { email: resetEmail },
      expected: 429,
    });
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    console.log(
      "TLS email delivery, neutral recovery, expiry, replacement, single-use races, session revocation, password change and recovery rate limiting passed.",
    );
  } finally {
    await recoveryDb
      .collection("users")
      .deleteOne({ email: `reset-${runId}@example.invalid` });
    await recoveryDb.close();
  }
  const { csrfToken } = await (await request("/api/auth/csrf")).json();
  await request("/api/auth/signout", { form: { csrfToken, json: "true" } });
  assert.deepEqual(await (await request("/api/auth/session")).json(), {});
  await request("/api/imagekit-auth", { expected: 401 });
  await request("/api/videos", {
    data: { title: "Logged out" },
    expected: 401,
  });
  if (!configuredDatabase) {
    const { default: mongoose } = await import("mongoose");
    const db = await mongoose.createConnection(databaseUri).asPromise();
    const batch = Array.from({ length: 10 }, (_, index) => ({
      _id: new mongoose.Types.ObjectId(),
      title: `Pagination ${runId} ${index}`,
      description: "Pagination check",
      videoUrl: "https://example.invalid/test.mp4",
      thumbNailUrl: "https://example.invalid/test.jpg",
      createdAt: new Date(Date.now() - index * 1000),
      updatedAt: new Date(),
    }));
    try {
      await db.collection("videos").insertMany(batch);
      let page = await (
        await request("/api/videos", { anonymous: true })
      ).json();
      assert.equal(page.videos.length, 5);
      assert.equal(page.total, 10);
      const ids = new Set(page.videos.map((video) => video.id));
      for (let index = 0; index < 5; index++) {
        page = await (
          await request(`/api/videos?limit=5&cursor=${page.nextCursor}`, {
            anonymous: true,
          })
        ).json();
        assert.equal(page.videos.length, 1);
        assert.ok(!ids.has(page.videos[0].id));
        ids.add(page.videos[0].id);
      }
      assert.equal(ids.size, 10);
      assert.equal(page.nextCursor, null);
      await request("/api/videos?limit=6", { anonymous: true, expected: 400 });
      console.log(
        "Five initial videos, one per subsequent page, bounded requests and duplicate-free pagination passed.",
      );
    } finally {
      await db
        .collection("videos")
        .deleteMany({ _id: { $in: batch.map((video) => video._id) } });
      await db.close();
    }
  }
  if (process.argv.includes("--hold")) {
    console.log(
      `Browser test server: ${base} (runner PID ${process.pid}). Send SIGINT to finish and clean up.`,
    );
    await once(process, "SIGINT");
  }
  if (!configuredDatabase) {
    await database.stop();
    const failure = await signIn({ email, password }, 401);
    const { url } = await failure.json();
    assert.equal(
      new URL(url).searchParams.get("error"),
      "Sign-in is temporarily unavailable. Please try again later.",
    );
    await request("/api/auth/register", {
      data: {
        email: `offline-${email}`,
        password,
        name: "Offline Creator",
        dateOfBirth: "1998-01-23",
      },
      expected: 503,
    });
    await request("/api/videos", { anonymous: true, expected: 503 });
    console.log(
      "Database outage returns controlled errors without exposing connection details.",
    );
  }
  console.log(
    `PASS: ${checks} end-to-end checks, including logout and upload access control.`,
  );
} catch (error) {
  console.error("E2E failed:", error.message);
  process.exitCode = 1;
} finally {
  if (uploaded.length) {
    const imagekit = new ImageKit({
      publicKey: process.env.REELOGRAM_NEXT_PUBLIC_PUBLIC_KEY,
      privateKey: process.env.REELOGRAM_PRIVATE_KEY,
      urlEndpoint: process.env.REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT,
    });
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
  if (mail) await mail.stop();
  if (database) await database.stop();
  if (configuredDatabase && registrationAttempted) {
    let connection;
    try {
      const mongoose = (await import("mongoose")).default;
      connection = await mongoose
        .createConnection(databaseUri, { serverSelectionTimeoutMS: 10000 })
        .asPromise();
      await connection
        .collection("videos")
        .deleteMany({ fileId: { $in: uploaded } });
      assert.equal(
        await connection
          .collection("videos")
          .countDocuments({ fileId: { $in: uploaded } }),
        0,
      );
      await connection.collection("emailjobs").deleteMany({
        to: { $in: [email, otherEmail, `reset-${runId}@example.invalid`] },
      });
      await connection
        .collection("users")
        .deleteMany({ email: { $in: [email, otherEmail] } });
      assert.equal(
        await connection
          .collection("users")
          .countDocuments({ email: { $in: [email, otherEmail] } }),
        0,
      );
      console.log(
        "Deleted this run's test account and video records from the configured database.",
      );
    } catch {
      console.error("Could not clean up test account:", email);
      process.exitCode = 1;
    } finally {
      if (connection) await connection.close();
    }
  }
  await rm(".e2e.tsconfig.json", { force: true });
}
