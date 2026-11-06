import { mkdir, writeFile } from "node:fs/promises";
import { readReleaseVersion } from "./metadata.mjs";

try {
  const version = await readReleaseVersion();
  const directory = new URL("../../.release-notes/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const name = `v${version}.md`;
  const note = `# ReeloGram v${version}

Status: Draft — local only; not published.
Release date: To be confirmed
Commit: To be recorded after validation

## Summary

Describe the changes that matter to users.

## Added

## Changed

## Fixed

## Security

Describe resolved issues without credentials, personal data or exploit instructions.

## Compatibility and configuration

Record required settings, migrations and any breaking changes. Do not include secret values.

## Verification

Record checks performed and their results.

## Rollback

Record the previous release and any data/configuration rollback requirements.
`;
  try {
    // Never overwrite an edited draft when rerunning the command.
    await writeFile(new URL(name, directory), note, { flag: "wx" });
    console.log(
      `Created local draft .release-notes/${name}. It is ignored by Git.`,
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    console.log(`Kept existing .release-notes/${name} unchanged.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
