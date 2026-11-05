import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import bundled from "../lib/email/disposable-domains.json" with { type: "json" };
import {
  createBlocklistReader,
  refreshStoredBlocklist,
} from "../lib/email/blocklist-store.ts";

const server = await MongoMemoryServer.create({
  binary: { downloadDir: join(tmpdir(), "reelogram-mongodb-binaries") },
});
const connection = await mongoose.createConnection(server.getUri()).asPromise();
try {
  const collection = connection.collection("email_blocklists");
  let clock = Date.now();
  const reader = createBlocklistReader(
    async () =>
      (await collection.findOne({ _id: "disposable-email" }))?.snapshot || null,
    () => clock,
  );
  assert.equal((await reader()).has("daily-regression.example"), false);
  let downloads = 0;
  const snapshot = {
    ...bundled,
    domains: [...bundled.domains, "daily-regression.example"],
  };
  const download = async () => {
    downloads++;
    return snapshot;
  };
  const concurrent = await Promise.all(
    Array.from({ length: 12 }, () =>
      refreshStoredBlocklist(collection, download, new Date(clock)),
    ),
  );
  assert.equal(downloads, 1);
  assert.equal(
    concurrent.filter((value) => value.status === "updated").length,
    1,
  );
  assert.equal(
    (await reader()).has("daily-regression.example"),
    false,
    "Warm cache is bounded",
  );
  clock += 5 * 60000 + 1;
  assert.equal(
    (await reader()).has("daily-regression.example"),
    true,
    "New domain is loaded without a deployment or restart",
  );
  const nextDay = new Date(clock + 24 * 3600000);
  await assert.rejects(
    refreshStoredBlocklist(
      collection,
      async () => {
        throw Error("upstream unavailable");
      },
      nextDay,
    ),
    /unavailable/,
  );
  assert.deepEqual(
    (await collection.findOne({ _id: "disposable-email" })).snapshot,
    snapshot,
    "Failed refresh must preserve all prior domains",
  );
  assert.equal(
    (await refreshStoredBlocklist(collection, download, nextDay)).status,
    "not-due",
    "Failed downloads have a retry cooldown",
  );
  const retryTime = new Date(nextDay.getTime() + 3600001);
  await assert.rejects(
    refreshStoredBlocklist(
      collection,
      async () => ({ ...bundled, domains: ["gmail.com"] }),
      retryTime,
    ),
    /Unexpected/,
  );
  assert.deepEqual(
    (await collection.findOne({ _id: "disposable-email" })).snapshot,
    snapshot,
  );
  clock += 5 * 60000 + 1;
  await collection.updateOne(
    { _id: "disposable-email" },
    { $set: { "snapshot.domains": ["gmail.com"] } },
  );
  assert.equal(
    (await reader()).has("daily-regression.example"),
    true,
    "Invalid stored data retains the last good in-memory list",
  );
  console.log(
    "PASS: daily persistence, concurrent lease, hot cache refresh, outage retention, malformed data and retry cooldown.",
  );
} finally {
  await connection.close();
  await server.stop();
}
