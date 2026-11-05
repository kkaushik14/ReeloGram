/** Check file bytes rather than trusting a browser MIME label or extension. */
export async function validateClip(file: File): Promise<string | null> {
  if (!file.size) return "The selected file is empty.";
  if (file.size > 100 * 1024 * 1024)
    return "Choose a video or GIF up to 100 MB.";
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const text = new TextDecoder("ascii").decode(bytes);
  const gif = text.startsWith("GIF87a") || text.startsWith("GIF89a");
  const mp4 = bytes.length >= 12 && text.slice(4, 8) === "ftyp";
  const webm =
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3;
  return gif || mp4 || webm
    ? null
    : "Choose an MP4, WebM or GIF file. Renaming another file does not convert it.";
}
