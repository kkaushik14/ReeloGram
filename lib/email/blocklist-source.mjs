import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";

export const source =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
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

export async function downloadBlocklist(fetcher = fetch, previousCount = 0) {
  const response = await fetcher(source, {
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!response.ok || !response.body) throw Error("Blocklist download failed");
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
  if (previousCount && domains.length < previousCount * 0.8)
    throw Error("Unexpected blocklist reduction");
  return {
    source,
    license: "CC0-1.0",
    fetchedAt: new Date().toISOString(),
    sha256: createHash("sha256").update(text).digest("hex"),
    domains,
  };
}
