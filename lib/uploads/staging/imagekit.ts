import { getMediaFile } from "../../video-media.ts";
import { objectUrl } from "./storage.ts";
import type { Asset } from "./repository.ts";
export class PermanentUploadError extends Error {}
function authorization() {
  const key = process.env.REELOGRAM_PRIVATE_KEY;
  if (!key) throw Error("ImageKit unavailable");
  return `Basic ${Buffer.from(key + ":").toString("base64")}`;
}
/** Reconcile a lost response by exact server-generated path before attempting another transfer. */
export async function findTransferredAsset(asset: Asset) {
  const headers = { Authorization: authorization() };
  const path = `${asset.folder}/${asset.fileName}`;
  const query = new URLSearchParams({
    path: asset.folder,
    searchQuery: `name = "${asset.fileName}"`,
    limit: "10",
  });
  const existing = await fetch(`https://api.imagekit.io/v1/files?${query}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!existing.ok) throw Error("ImageKit lookup unavailable");
  const files: { filePath?: string; fileId?: string }[] = await existing.json();
  if (!Array.isArray(files)) throw Error("Unexpected ImageKit response");
  const match = files.find(
    (file) => file.filePath === path && typeof file.fileId === "string",
  );
  return match?.fileId;
}
export async function transferAsset(asset: Asset) {
  const found = await findTransferredAsset(asset);
  if (found) return found;
  const path = `${asset.folder}/${asset.fileName}`;
  const headers = { Authorization: authorization() };
  const form = new FormData();
  form.set("file", await objectUrl(asset.key));
  form.set("folder", asset.folder);
  form.set("fileName", asset.fileName);
  form.set("useUniqueFileName", "false");
  form.set("overwriteFile", "false");
  form.set("isPrivateFile", "false");
  form.set(
    "checks",
    `"file.size" <= ${asset.size} AND "file.mime" IN ${JSON.stringify([asset.mime])}`,
  );
  const response = await fetch(
    "https://upload.imagekit.io/api/v1/files/upload",
    { method: "POST", headers, body: form, signal: AbortSignal.timeout(30000) },
  );
  if ([400, 413, 415, 422].includes(response.status))
    throw new PermanentUploadError(
      "ImageKit could not accept this file. Check its format and size, then upload again.",
    );
  if (!response.ok) throw Error("ImageKit transfer unavailable");
  const result = await response.json();
  if (typeof result.fileId !== "string")
    throw Error("ImageKit transfer unconfirmed");
  const verified = await getMediaFile(result.fileId);
  if (verified.filePath !== path || verified.size !== asset.size)
    throw new PermanentUploadError("The uploaded file could not be verified.");
  return result.fileId as string;
}
