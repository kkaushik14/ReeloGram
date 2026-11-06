import { Types, type Connection } from "mongoose";
import { connectToDatabase } from "../../db.ts";
import type { AssetKind } from "./policy.ts";
export type Asset = {
  _id: Types.ObjectId;
  owner: string;
  kind: AssetKind;
  size: number;
  mime: string;
  key: string;
  multipartId?: string;
  folder: string;
  fileName: string;
  status: "starting" | "uploading" | "ready" | "claimed" | "cancelled";
  expiresAt: Date;
  createdAt: Date;
  jobId?: string;
  fileId?: string;
  purgedAt?: Date;
};
export type UploadJob = {
  _id: Types.ObjectId;
  owner: string;
  sessionVersion: number;
  video: string;
  image: string;
  title: string;
  description: string;
  status: "queued" | "processing" | "published" | "failed";
  createdAt: Date;
  expiresAt: Date;
  queuedAt?: Date;
  leaseUntil?: Date;
  leaseToken?: string;
  failures: number;
  error?: string;
  nextRetryAt?: Date;
  videoId?: string;
  purgeAt?: Date;
};
const indexes = new WeakMap<Connection, Promise<unknown>>();
export async function uploadCollections() {
  const connection = await connectToDatabase();
  const assets = connection.collection<Asset>("upload_assets");
  const jobs = connection.collection<UploadJob>("upload_jobs");
  let ready = indexes.get(connection);
  if (!ready) {
    ready = Promise.all([
      assets.createIndex({ owner: 1, status: 1, expiresAt: 1 }),
      assets.createIndex({ expiresAt: 1 }),
      assets.createIndex({ purgedAt: 1 }, { expireAfterSeconds: 7 * 86400 }),
      jobs.createIndex({ owner: 1, createdAt: -1 }),
      jobs.createIndex({ status: 1, queuedAt: 1 }),
      jobs.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
    ]).catch((error) => {
      indexes.delete(connection);
      throw error;
    });
    indexes.set(connection, ready);
  }
  await ready;
  return { connection, assets, jobs };
}
export function presentJob(job: UploadJob) {
  return {
    id: String(job._id),
    title: job.title,
    status: job.status,
    error: job.error,
    nextRetryAt: job.nextRetryAt?.toISOString(),
    videoId: job.videoId,
    createdAt: job.createdAt.toISOString(),
  };
}
