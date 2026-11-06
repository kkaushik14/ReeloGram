import { Types } from "mongoose";
import { AuthRequestError } from "../../security/request.ts";
import { withPublishingAccount } from "../../account/publishing-guard.ts";
import { mediaLocation } from "../naming.ts";
import { uploadCollections } from "./repository.ts";
import {
  assetInput,
  expectedParts,
  matchesSignature,
  STAGING_POLICY,
  validParts,
  validUploadId,
} from "./policy.ts";
import * as storage from "./storage.ts";

export async function createAsset(
  owner: { id: string; name?: string | null; sessionVersion: number },
  body: Record<string, unknown>,
) {
  const input = assetInput(body);
  if (!input)
    throw new AuthRequestError(
      "Choose an MP4, WebM or GIF up to 100 MB, or a JPG, PNG or WebP cover up to 5 MB.",
    );
  const { assets } = await uploadCollections();
  const _id = new Types.ObjectId();
  const asset = {
    _id,
    owner: owner.id,
    ...input,
    key: `drafts/${owner.id}/${_id}`,
    ...mediaLocation({
      ownerId: owner.id,
      name: owner.name,
      purpose: input.kind === "video" ? "video" : "thumbnail",
      videoId: String(_id),
    }),
    status: "starting" as const,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + STAGING_POLICY.draftHours * 3600000),
  };
  await withPublishingAccount(
    owner.id,
    owner.sessionVersion,
    async (session) => {
      const active = await assets
        .find({ owner: owner.id, purgedAt: { $exists: false } }, { session })
        .toArray();
      if (
        active.length >= STAGING_POLICY.maximumAssets ||
        active.reduce((sum, a) => sum + a.size, 0) + input.size >
          STAGING_POLICY.maximumAccountBytes
      )
        throw new AuthRequestError(
          "Finish or cancel your other uploads first. Failed uploads are cleared automatically; try again in a few minutes.",
          429,
        );
      await assets.insertOne(asset, { session });
    },
  );
  try {
    const multipartId = await storage.startMultipart(asset.key, asset.mime);
    const updated = await assets.updateOne(
      { _id, status: "starting" },
      { $set: { multipartId, status: "uploading" } },
    );
    if (!updated.matchedCount) {
      await storage.removeObject(asset.key, multipartId);
      throw new AuthRequestError("This upload was cancelled.", 409);
    }
    return { id: String(_id), partBytes: STAGING_POLICY.partBytes };
  } catch (error) {
    await assets.updateOne(
      { _id },
      { $set: { status: "cancelled", expiresAt: new Date() } },
    );
    throw error;
  }
}
export async function ownedAsset(owner: string, id: string) {
  if (!validUploadId(id)) throw new AuthRequestError("Upload not found.", 404);
  const { assets } = await uploadCollections();
  const asset = await assets.findOne({ _id: new Types.ObjectId(id), owner });
  if (!asset) throw new AuthRequestError("Upload not found.", 404);
  if (asset.expiresAt.getTime() <= Date.now() || asset.status === "cancelled")
    throw new AuthRequestError(
      "This draft has expired or was cancelled. Choose the file again.",
      410,
    );
  return asset;
}
export async function resumeAsset(owner: string, id: string) {
  const asset = await ownedAsset(owner, id);
  if (asset.status === "ready" || asset.status === "claimed")
    return { id, status: asset.status, parts: [] };
  if (asset.status !== "uploading" || !asset.multipartId)
    throw new AuthRequestError(
      "This upload is still being prepared. Try again shortly.",
      409,
    );
  try {
    const parts = await storage.listParts(asset.key, asset.multipartId);
    return {
      id,
      status: asset.status,
      parts: parts.map((p) => ({ part: p.PartNumber, size: p.Size })),
    };
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "NoSuchUpload") throw error;
    return { ...(await finishAsset(owner, id)), parts: [] };
  }
}
export async function signParts(
  owner: string,
  id: string,
  body: Record<string, unknown>,
) {
  const asset = await ownedAsset(owner, id);
  if (asset.status !== "uploading" || !asset.multipartId)
    throw new AuthRequestError("This upload cannot accept more parts.", 409);
  const parts = body.parts;
  if (
    !Array.isArray(parts) ||
    !parts.length ||
    parts.length > 16 ||
    new Set(parts).size !== parts.length ||
    parts.some(
      (p) => !Number.isSafeInteger(p) || p < 1 || p > expectedParts(asset.size),
    )
  )
    throw new AuthRequestError("Invalid upload parts.");
  return storage.partUrls(asset.key, asset.multipartId, asset.size, parts);
}
export async function finishAsset(owner: string, id: string) {
  const asset = await ownedAsset(owner, id);
  if (asset.status === "ready") return { id, status: "ready" };
  if (asset.status !== "uploading" || !asset.multipartId)
    throw new AuthRequestError("This upload cannot be completed.", 409);
  try {
    const parts = await storage.listParts(asset.key, asset.multipartId);
    if (!validParts(parts, asset.size))
      throw new AuthRequestError(
        "Some file parts are missing or have the wrong size. Retry this upload.",
      );
    await storage.completeMultipart(asset.key, asset.multipartId, parts);
  } catch (error) {
    // A previous completion may have succeeded while its response was lost.
    if (!(error instanceof Error) || error.name !== "NoSuchUpload") throw error;
  }
  const object = await storage.inspectObject(asset.key);
  if (
    object.size !== asset.size ||
    !matchesSignature(object.bytes, asset.mime)
  ) {
    await cancelAsset(owner, id);
    throw new AuthRequestError(
      "This file does not match its selected format or size. Choose a valid file.",
    );
  }
  const { assets } = await uploadCollections();
  const result = await assets.updateOne(
    { _id: asset._id, status: "uploading" },
    { $set: { status: "ready" } },
  );
  if (!result.matchedCount) {
    const latest = await assets.findOne({ _id: asset._id });
    if (latest?.status === "ready" || latest?.status === "claimed")
      return { id, status: latest.status };
    await storage.removeObject(asset.key, asset.multipartId);
    throw new AuthRequestError("This upload was cancelled.", 409);
  }
  return { id, status: "ready" };
}
export async function cancelAsset(owner: string, id: string) {
  if (!validUploadId(id)) throw new AuthRequestError("Upload not found.", 404);
  const { assets } = await uploadCollections();
  const asset = await assets.findOneAndUpdate(
    {
      _id: new Types.ObjectId(id),
      owner,
      status: { $in: ["starting", "uploading", "ready", "cancelled"] },
    },
    { $set: { status: "cancelled", expiresAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!asset)
    throw new AuthRequestError(
      "This upload is unavailable or already submitted.",
      409,
    );
  if (!asset.purgedAt) {
    await storage.removeObject(asset.key, asset.multipartId);
    await assets.updateOne(
      { _id: asset._id, status: "cancelled" },
      { $set: { purgedAt: new Date() } },
    );
  }
}
