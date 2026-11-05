import sharp from "sharp";
import { AuthRequestError, assertSameOrigin } from "../security/request.ts";
import { AVATAR_MAX_BYTES } from "./profile.ts";

export async function readAvatar(request: Request) {
  assertSameOrigin(request);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
    throw new AuthRequestError("Choose a profile photo.", 415);
  const maximum = AVATAR_MAX_BYTES + 16384;
  if (Number(request.headers.get("content-length")) > maximum)
    throw new AuthRequestError("Choose an image up to 2 MB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthRequestError("Choose a profile photo.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) {
        await reader.cancel();
        throw new AuthRequestError("Choose an image up to 2 MB.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type")! },
      body: Buffer.concat(chunks),
    }).formData();
  } catch {
    throw new AuthRequestError("Choose a valid profile photo.");
  }
  if (
    [...form.keys()].some((key) => key !== "file") ||
    form.getAll("file").length !== 1
  )
    throw new AuthRequestError("Only a profile photo can be changed here.");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size || file.size > AVATAR_MAX_BYTES)
    throw new AuthRequestError("Choose an image up to 2 MB.");
  return normalizeAvatar(Buffer.from(await file.arrayBuffer()));
}

export async function normalizeAvatar(bytes: Buffer) {
  try {
    const image = sharp(bytes, {
      limitInputPixels: 16777216,
      animated: false,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(metadata.format || "") ||
      (metadata.pages || 1) > 1
    )
      throw Error("Unsupported image");
    // Re-encoding drops embedded scripts and location/EXIF metadata.
    return await image
      .rotate()
      .resize(384, 384, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
  } catch {
    throw new AuthRequestError("Choose a valid, still JPG, PNG or WebP image.");
  }
}
