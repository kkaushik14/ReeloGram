import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { configureNextAuthEnvironment } from "../lib/auth/environment.ts";

test("NextAuth reserved variables use the ReeloGram configuration over stale deployment settings", () => {
  const environment = {
    REELOGRAM_NEXTAUTH_URL: "https://reelogram.example",
    REELOGRAM_NEXTAUTH_SECRET: "project-specific-secret",
    NEXTAUTH_URL: "https://stale.example",
    NEXTAUTH_SECRET: "stale-secret",
    NEXTAUTH_URL_INTERNAL: "http://stale.internal",
  };
  configureNextAuthEnvironment(environment);
  assert.equal(environment.NEXTAUTH_URL, "https://reelogram.example");
  assert.equal(environment.NEXTAUTH_SECRET, "project-specific-secret");
  assert.ok(!("NEXTAUTH_URL_INTERNAL" in environment));
  const missing = {
    NEXTAUTH_URL: "https://stale.example",
    NEXTAUTH_SECRET: "stale-secret",
  };
  configureNextAuthEnvironment(missing);
  assert.deepEqual(missing, {});
});

test("the browser environment allowlist contains only the two public ImageKit settings", async () => {
  const config = await readFile(
    new URL("../next.config.ts", import.meta.url),
    "utf8",
  );
  const clientEnv = config.match(/\benv:\s*\{([\s\S]*?)\n\s*\}/)[1];
  const references = [...clientEnv.matchAll(/process\.env\.([A-Z_]+)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(references.sort(), [
    "REELOGRAM_NEXT_PUBLIC_PUBLIC_KEY",
    "REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT",
  ]);
  assert.ok(!/(?:SECRET|PASSWORD|PRIVATE_KEY|MONGODB)/.test(clientEnv));
  const sample = await readFile(
    new URL("../env.sample", import.meta.url),
    "utf8",
  );
  const keys = sample
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0]);
  assert.ok(keys.every((key) => key.startsWith("REELOGRAM_")));
});
