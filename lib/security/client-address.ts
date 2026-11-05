import { isIP } from "node:net";

export function clientAddress(headers: Headers, environment = process.env) {
  if (
    environment.VERCEL !== "1" &&
    environment.REELOGRAM_AUTH_TRUST_PROXY !== "1"
  )
    return "shared";
  const address = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  if (isIP(address) === 4) return address;
  const mapped = address.toLowerCase().replace(/^::ffff:/, "");
  if (mapped !== address.toLowerCase() && isIP(mapped) === 4) return mapped;
  if (isIP(address) !== 6) return "unknown";
  // Count an IPv6 /64 together so rotating interface addresses cannot bypass limits.
  const [left, right = ""] = address.toLowerCase().split("::");
  const first = left.split(":").filter(Boolean),
    last = right.split(":").filter(Boolean);
  return (
    [
      ...first,
      ...Array(Math.max(0, 8 - first.length - last.length)).fill("0"),
      ...last,
    ]
      .slice(0, 4)
      .map((part) => part.replace(/^0+(?=.)/, ""))
      .join(":") + "::/64"
  );
}
