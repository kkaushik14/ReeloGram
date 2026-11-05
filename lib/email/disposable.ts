import snapshot from "./disposable-domains.json" with { type: "json" };

const domains = new Set(snapshot.domains);

/** Match exact domains and their subdomains, never arbitrary string suffixes. */
export function isSupplementaryDisposableDomain(domain: string) {
  const labels = domain.toLowerCase().split(".");
  for (let index = 0; index < labels.length - 1; index++) {
    if (domains.has(labels.slice(index).join("."))) return true;
  }
  return false;
}
