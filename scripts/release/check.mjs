import { readReleaseVersion } from "./metadata.mjs";

try {
  console.log(`Release metadata is consistent: v${await readReleaseVersion()}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
