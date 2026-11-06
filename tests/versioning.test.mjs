import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReleaseMetadata } from "../scripts/release/metadata.mjs";

const metadata = (version) => [
  { version, private: true },
  { version, packages: { "": { version } } },
];
test("release metadata accepts stable and prerelease semantic versions", () => {
  for (const version of ["1.0.0", "1.2.3-rc.1", "2.0.0-beta+build.42"])
    assert.equal(validateReleaseMetadata(...metadata(version)), version);
});
test("release checks block malformed versions, lockfile drift and npm publication", () => {
  for (const version of [
    "v1.0.0",
    "1.0",
    "01.0.0",
    "1.0.0-01",
    "1.0.0/../notes",
    "1.0.0\n",
  ])
    assert.throws(() => validateReleaseMetadata(...metadata(version)));
  const [manifest, lock] = metadata("1.0.0");
  assert.throws(() =>
    validateReleaseMetadata(manifest, { ...lock, version: "0.1.0" }),
  );
  assert.throws(() =>
    validateReleaseMetadata(manifest, { ...lock, packages: {} }),
  );
  assert.throws(() =>
    validateReleaseMetadata({ ...manifest, private: false }, lock),
  );
});
