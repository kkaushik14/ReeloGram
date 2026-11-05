import { readFile, writeFile, rename } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  parseBlocklist,
  downloadBlocklist,
} from "../lib/email/blocklist-source.mjs";
export { parseBlocklist } from "../lib/email/blocklist-source.mjs";
const destination = new URL(
  "../lib/email/disposable-domains.json",
  import.meta.url,
);

export async function refreshBlocklist({
  fetcher = fetch,
  target = destination,
  fallback = false,
} = {}) {
  let previous;
  try {
    previous = JSON.parse(await readFile(target, "utf8"));
    parseBlocklist(previous.domains.join("\n"));
  } catch {
    previous = null;
  }
  try {
    const data = await downloadBlocklist(
      fetcher,
      previous?.domains.length || 0,
    );
    const { domains } = data;
    if (
      previous &&
      JSON.stringify(previous.domains) === JSON.stringify(domains)
    )
      return { status: "current", count: domains.length };
    const temporary = new URL(target.toString() + ".tmp");
    await writeFile(temporary, JSON.stringify(data, null, 2) + "\n");
    await rename(temporary, target);
    return { status: "updated", count: domains.length };
  } catch (error) {
    if (!fallback || !previous) throw error;
    // An unavailable or malformed upstream must never disable existing checks.
    console.warn(
      "Email blocklist refresh unavailable; using the bundled validated snapshot.",
    );
    return { status: "bundled", count: previous.domains.length };
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await refreshBlocklist({
    fallback: process.argv.includes("--fallback"),
  });
  console.log(
    `Supplementary email blocklist: ${result.status} (${result.count} domains).`,
  );
}
