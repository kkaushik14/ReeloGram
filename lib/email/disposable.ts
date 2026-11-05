import { liveBlocklist } from "./blocklist-store.ts";

/** Match exact domains and their subdomains, never arbitrary string suffixes. */
export async function isSupplementaryDisposableDomain(domain: string) {
  const domains = await liveBlocklist();
  const labels = domain.toLowerCase().split(".");
  for (let index = 0; index < labels.length - 1; index++) {
    if (domains.has(labels.slice(index).join("."))) return true;
  }
  return false;
}
