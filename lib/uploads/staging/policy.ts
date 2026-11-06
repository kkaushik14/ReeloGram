export const STAGING_POLICY = {
  partBytes: 8 * 1024 * 1024,
  videoBytes: 100 * 1024 * 1024,
  imageBytes: 5 * 1024 * 1024,
  signedUrlSeconds: 600,
  draftHours: 24,
  maximumAssets: 6,
  maximumAccountBytes: 310 * 1024 * 1024,
  jobHours: 24,
} as const;
export type AssetKind = "video" | "image";
export function assetInput(
  value: Record<string, unknown>,
): { kind: AssetKind; size: number; mime: string } | null {
  const { kind, size, mime } = value;
  if (kind !== "video" && kind !== "image") return null;
  const allowed =
    kind === "video"
      ? ["video/mp4", "video/webm", "image/gif"]
      : ["image/jpeg", "image/png", "image/webp"];
  if (
    typeof mime !== "string" ||
    !allowed.includes(mime) ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size >
      (kind === "video" ? STAGING_POLICY.videoBytes : STAGING_POLICY.imageBytes)
  )
    return null;
  return { kind, size, mime };
}
export const validUploadId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{24}$/.test(value);
export function expectedParts(size: number) {
  return Math.ceil(size / STAGING_POLICY.partBytes);
}
export function partSize(size: number, part: number) {
  return Math.min(
    STAGING_POLICY.partBytes,
    size - (part - 1) * STAGING_POLICY.partBytes,
  );
}
export function validParts(
  parts: { PartNumber?: number; Size?: number; ETag?: string }[],
  size: number,
) {
  return (
    parts.length === expectedParts(size) &&
    parts.every(
      (p, index) =>
        p.PartNumber === index + 1 &&
        p.Size === partSize(size, index + 1) &&
        typeof p.ETag === "string" &&
        !!p.ETag,
    )
  );
}
/** Header signatures are only a quick screen; ImageKit verifies media again before publication. */
export function matchesSignature(bytes: Uint8Array, mime: string) {
  const text = new TextDecoder("ascii").decode(bytes);
  if (mime === "video/mp4")
    return bytes.length >= 12 && text.slice(4, 8) === "ftyp";
  if (mime === "video/webm")
    return (
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    );
  if (mime === "image/gif") return /^GIF8[79]a/.test(text);
  if (mime === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  return (
    mime === "image/webp" &&
    text.startsWith("RIFF") &&
    text.slice(8, 12) === "WEBP"
  );
}
