import { createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { pathToFileURL, domainToASCII } from "node:url";

export const source =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
const destination = new URL(
  "../lib/email/disposable-domains.json",
  import.meta.url,
);
const maxBytes = 1024 * 1024;

export function parseBlocklist(text) {
  if (Buffer.byteLength(text) > maxBytes) throw Error("Blocklist is too large");
  const domains = [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((domain) => {
          const ascii = domainToASCII(domain.toLowerCase());
          if (
            ascii.length > 253 ||
            !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(
              ascii,
            )
          )
            throw Error("Invalid blocklist domain");
          return ascii;
        }),
    ),
  ].sort();
  if (
    domains.length < 1000 ||
    [
      "gmail.com",
      "outlook.com",
      "yahoo.com",
      "icloud.com",
      "proton.me",
      "protonmail.com",
    ].some((domain) => domains.includes(domain))
  )
    throw Error("Unexpected blocklist contents");
  return domains;
}

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
    const response = await fetcher(source, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!response.ok || !response.body)
      throw Error("Blocklist download failed");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw Error("Blocklist is too large");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const domains = parseBlocklist(text);
    if (previous && domains.length < previous.domains.length * 0.8)
      throw Error("Unexpected blocklist reduction");
    if (
      previous &&
      JSON.stringify(previous.domains) === JSON.stringify(domains)
    )
      return { status: "current", count: domains.length };
    const data = {
      source,
      license: "CC0-1.0",
      fetchedAt: new Date().toISOString(),
      sha256: createHash("sha256").update(text).digest("hex"),
      domains,
    };
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
