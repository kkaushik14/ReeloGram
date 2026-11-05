import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
const require = createRequire(import.meta.url);
const { encode } = require("next-auth/jwt");
const secret = randomBytes(32).toString("hex");
const listener = createServer().listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
let mongo, client, server, exited;
let checks = 0;
async function request(path, status = 200, options = {}) {
  const response = await fetch(base + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(45000),
    ...options,
  });
  assert.equal(response.status, status, `${path} status`);
  checks++;
  return response;
}
function validXml(body) {
  execFileSync(
    "python3",
    [
      "-c",
      "import sys,xml.etree.ElementTree as ET; ET.fromstring(sys.stdin.read())",
    ],
    { input: body },
  );
  checks++;
}
try {
  mongo = await MongoMemoryServer.create({
    instance: { dbName: "seo_tests" },
    binary: { downloadDir: join(tmpdir(), "reelogram-mongodb-binaries") },
  });
  client = await MongoClient.connect(mongo.getUri("seo_tests"));
  const db = client.db("seo_tests");
  const owner = new ObjectId();
  await db.collection("users").insertOne({
    _id: owner,
    name: "SEO Creator",
    email: "must-not-leak@example.invalid",
    dateOfBirth: new Date("2001-02-03"),
    password: "must-not-leak-password",
  });
  const title =
    "Ocean & sky <sunset> </script><script>window.bad=true</script>";
  const record = {
    _id: new ObjectId(),
    title,
    description: "A quiet coast & evening light.",
    uploadedBy: owner,
    placement: "feed",
    deletionPending: false,
    videoUrl: "https://ik.imagekit.io/seo-test/sea.mp4",
    thumbNailUrl: "https://ik.imagekit.io/seo-test/sea.jpg",
    fileId: "private-media-id",
    createdAt: new Date("2026-01-23T00:00:00Z"),
    updatedAt: new Date("2026-01-23T00:00:00Z"),
  };
  const hidden = ["hero", "archived", "private"].map((placement) => ({
    ...record,
    _id: new ObjectId(),
    placement,
  }));
  const deleting = { ...record, _id: new ObjectId(), deletionPending: true };
  const legacy = {
    ...record,
    _id: new ObjectId(),
    title: "Legacy public video",
  };
  delete legacy.placement;
  await db
    .collection("videos")
    .insertMany([record, ...hidden, deleting, legacy]);
  await writeFile(
    ".e2e.tsconfig.json",
    JSON.stringify({ extends: "./tsconfig.json" }),
  );
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
        REELOGRAM_MONGODB_URL: mongo.getUri("seo_tests"),
        REELOGRAM_APP_URL: base,
        REELOGRAM_NEXTAUTH_URL: base,
        REELOGRAM_NEXTAUTH_SECRET: secret,
        REELOGRAM_EMAIL_PROVIDER: "smtp",
        REELOGRAM_SMTP_HOST: "",
        REELOGRAM_E2E_DIST_DIR: ".next-seo",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  exited = once(server, "exit");
  server.stdout.on("data", (data) => {
    if (data.toString().includes("Ready in")) ready = true;
  });
  server.stderr.resume();
  const deadline = Date.now() + 60000;
  while (!ready) {
    assert.equal(server.exitCode, null);
    assert.ok(Date.now() < deadline, "startup timed out");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const robots = await (await request("/robots.txt")).text();
  assert.match(robots, /Sitemap: https:\/\/www\.reelogram\.in\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Allow: \/api\/videos/);
  assert.match(robots, /Allow: \/api\/showcase/);
  const index = await (await request("/sitemap.xml")).text();
  validXml(index);
  assert.match(index, /pages.xml/);
  assert.match(index, /videos-0.xml/);
  const pages = await (await request("/sitemaps/pages.xml")).text();
  validXml(pages);
  for (const path of [
    "login",
    "profile",
    "settings",
    "my-videos",
    "upload",
    "reset-password",
  ])
    assert.ok(!pages.includes(`/${path}<`));
  const sitemap = await (await request("/sitemaps/videos-0.xml")).text();
  validXml(sitemap);
  assert.ok(
    sitemap.includes(String(record._id)) &&
      sitemap.includes(String(legacy._id)),
  );
  for (const row of [...hidden, deleting])
    assert.ok(!sitemap.includes(String(row._id)));
  assert.ok(!sitemap.includes("must-not-leak"));
  assert.match(sitemap, /&lt;\/script&gt;/);
  await request("/sitemaps/videos-1.xml", 404);
  await request("/sitemaps/videos-000.xml", 404);
  await request(`/videos/${String(record._id).toUpperCase()}`, 308);
  const watch = await (await request(`/videos/${record._id}`)).text();
  assert.match(
    watch,
    /rel="canonical" href="https:\/\/www.reelogram.in\/videos\//,
  );
  assert.match(watch, /property="og:image"/);
  assert.match(watch, /name="twitter:card"/);
  assert.match(
    watch,
    /<video[^>]*src="https:\/\/ik.imagekit.io\/seo-test\/sea.mp4"/,
  );
  assert.match(watch, /SEO Creator/);
  for (const value of ["must-not-leak", "private-media-id", "2001-02-03"])
    assert.ok(!watch.includes(value));
  const blocks = [
    ...watch.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs),
  ].map((match) => JSON.parse(match[1]));
  const video = blocks.find((value) => value["@type"] === "VideoObject");
  assert.equal(video.name, title);
  assert.equal(video.contentUrl, record.videoUrl);
  assert.ok(video.uploadDate);
  assert.ok(!watch.includes("<script>window.bad=true</script>"));
  const metadataHead = watch.slice(0, watch.indexOf("</head>"));
  assert.match(metadataHead, /property="og:title"/);
  for (const row of [...hidden, deleting])
    await request(`/videos/${row._id}`, 404);
  await request(`/videos/${new ObjectId()}`, 404);
  await request("/videos/not-an-id", 404);
  const token = await encode({
    secret,
    token: { sub: String(owner), id: String(owner) },
    maxAge: 600,
  });
  const privatePage = await request("/my-videos", 200, {
    headers: { Cookie: `next-auth.session-token=${token}` },
  });
  assert.match(privatePage.headers.get("x-robots-tag"), /noindex/);
  assert.match(await privatePage.text(), /name="robots" content="noindex/);
  for (const path of ["/profile", "/settings", "/my-videos", "/upload"]) {
    const response = await request(path, 307);
    assert.match(response.headers.get("location"), /\/login\?/);
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
  }
  for (const path of [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/confirm-parent",
  ]) {
    const response = await request(path);
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
    assert.match(await response.text(), /name="robots" content="noindex/);
  }
  for (const path of [
    "/api/account",
    "/api/videos?mine=true",
    "/api/imagekit-auth",
  ])
    await request(path, 401);
  await request("/api/videos", 401, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  await request(`/api/videos/${record._id}`, 401, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: '{"title":"Unauthorized"}',
  });
  const home = await (await request("/")).text();
  assert.match(home, /rel="canonical" href="https:\/\/www.reelogram.in\/?"/);
  const filtered = await (await request("/?q=Ocean")).text();
  assert.match(filtered, /name="robots" content="noindex/);
  const old = await request(`/?video=${record._id}`, 308);
  assert.match(
    old.headers.get("location"),
    new RegExp(`/videos/${record._id}`),
  );
  await request(`/reels?video=${record._id}`, 308);
  const image = await request("/social-preview.png");
  assert.match(image.headers.get("content-type"), /image\/png/);
  await db
    .collection("videos")
    .updateOne(
      { _id: record._id },
      { $set: { title: "Updated coast", updatedAt: new Date("2026-02-01") } },
    );
  assert.match(
    await (await request(`/videos/${record._id}`)).text(),
    /Updated coast/,
  );
  assert.match(
    await (await request("/sitemaps/videos-0.xml")).text(),
    /2026-02-01/,
  );
  await db.collection("videos").deleteOne({ _id: record._id });
  await request(`/videos/${record._id}`, 404);
  assert.ok(
    !(await (await request("/sitemaps/videos-0.xml")).text()).includes(
      String(record._id),
    ),
  );
  const feed = await (await request("/api/videos")).json();
  assert.equal(feed.videos.length, 1);
  assert.equal(feed.videos[0].id, String(legacy._id));
  await db.collection("videos").deleteOne({ _id: legacy._id });
  assert.ok(
    !(await (await request("/sitemap.xml")).text()).includes("videos-0"),
  );
  await request("/sitemaps/videos-0.xml", 404);
  const batch = Array.from({ length: 1001 }, (_, i) => ({
    ...record,
    _id: new ObjectId(),
    title: `Page boundary ${i}`,
  }));
  batch[0].title = "A".repeat(120);
  await db.collection("videos").insertMany(batch);
  const partitioned = await (await request("/sitemap.xml")).text();
  assert.match(partitioned, /videos-1.xml/);
  const first = await (await request("/sitemaps/videos-0.xml")).text();
  const second = await (await request("/sitemaps/videos-1.xml")).text();
  assert.ok(first.includes(`<video:title>${"A".repeat(100)}</video:title>`));
  assert.equal((first.match(/<video:video>/g) || []).length, 1000);
  assert.equal((second.match(/<video:video>/g) || []).length, 1);
  const locations = [
    ...first.matchAll(/<loc>(.*?)<\/loc>/g),
    ...second.matchAll(/<loc>(.*?)<\/loc>/g),
  ].map((match) => match[1]);
  assert.equal(new Set(locations).size, 1001);
  await request("/sitemaps/videos-2.xml", 404);
  for (const row of hidden) await request(`/api/videos/${row._id}`, 404);
  await client.close();
  client = null;
  await mongo.stop();
  mongo = null;
  const outage = await request("/sitemap.xml", 503);
  assert.equal(outage.headers.get("retry-after"), "60");
  await request("/sitemaps/pages.xml");
  await request(`/videos/${record._id}`, 500);
  console.log(
    `SEO integration passed: ${checks} checks; public metadata, privacy, lifecycle, XML and outages.`,
  );
} finally {
  if (server) {
    server.kill("SIGTERM");
    await exited;
  }
  await client?.close();
  await mongo?.stop();
  await rm(".next-seo", { recursive: true, force: true });
  await rm(".e2e.tsconfig.json", { force: true });
}
