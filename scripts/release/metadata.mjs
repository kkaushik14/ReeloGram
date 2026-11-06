import { readFile } from "node:fs/promises";

// SemVer 2.0: numeric core; optional prerelease and build identifiers.
const numeric = "(?:0|[1-9][0-9]*)";
const prerelease = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const semver = new RegExp(
  `^${numeric}\\.${numeric}\\.${numeric}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

export function validateReleaseMetadata(manifest, lock) {
  const version = manifest.version;
  if (
    typeof version !== "string" ||
    version.trim() !== version ||
    !semver.test(version)
  )
    throw new Error("package.json must contain a valid semantic version.");
  if (lock.version !== version || lock.packages?.[""]?.version !== version)
    throw new Error(
      "Package and lockfile versions differ. Use npm version <version> --no-git-tag-version.",
    );
  if (manifest.private !== true)
    throw new Error(
      "ReeloGram must remain private to prevent accidental npm publication.",
    );
  return version;
}

export async function readReleaseVersion() {
  const root = new URL("../../", import.meta.url);
  const [manifest, lock] = await Promise.all(
    ["package.json", "package-lock.json"].map(async (name) =>
      JSON.parse(await readFile(new URL(name, root), "utf8")),
    ),
  );
  return validateReleaseMetadata(manifest, lock);
}
