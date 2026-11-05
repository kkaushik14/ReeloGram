import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseBlocklist,
  refreshBlocklist,
} from "../scripts/update-email-blocklist.mjs";

test("blocklist refresh validates data and retains its usable snapshot on outage or malformed downloads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reelogram-blocklist-"));
  const target = pathToFileURL(join(directory, "domains.json"));
  const domains = Array.from(
    { length: 1100 },
    (_, i) => `temporary-${i}.example`,
  ).sort();
  const original = JSON.stringify({ domains });
  try {
    await writeFile(target, original);
    for (const fetcher of [
      async () => {
        throw Error("offline");
      },
      async () => new Response("<html>Bad gateway</html>"),
    ]) {
      assert.equal(
        (await refreshBlocklist({ target, fetcher, fallback: true })).status,
        "bundled",
      );
      assert.equal(await readFile(target, "utf8"), original);
    }
    assert.throws(
      () => parseBlocklist([...domains, "gmail.com"].join("\n")),
      /Unexpected/,
    );
    assert.throws(
      () => parseBlocklist([...domains, "https://invalid.example"].join("\n")),
      /Invalid/,
    );
    const result = await refreshBlocklist({
      target,
      fetcher: async () =>
        new Response([...domains, "new-disposable.example"].join("\n")),
    });
    assert.equal(result.status, "updated");
    assert.equal(
      JSON.parse(await readFile(target, "utf8")).domains.length,
      1101,
    );
    await rm(target);
    await assert.rejects(
      refreshBlocklist({
        target,
        fallback: true,
        fetcher: async () => {
          throw Error("offline");
        },
      }),
      /offline/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
