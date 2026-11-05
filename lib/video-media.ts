import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

export class MediaBusyError extends Error {}
export class MediaNotFoundError extends Error {}

type MediaFile = { url: string; mime?: string; size: number; isPrivateFile: boolean };

async function mediaRequest(fileId: string, method: "GET" | "DELETE") {
    const key = process.env.PRIVATE_KEY;
    if (!key) throw new Error("ImageKit is not configured");
    return fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}${method === "GET" ? "/details" : ""}`, {
        method, headers: { Authorization: `Basic ${Buffer.from(key + ":").toString("base64")}` },
        signal: AbortSignal.timeout(10000), cache: "no-store",
    });
}

export async function getMediaFile(fileId: string): Promise<MediaFile> {
    const response = await mediaRequest(fileId, "GET");
    if (response.status === 404) throw new MediaNotFoundError();
    if (!response.ok) throw new Error("ImageKit file verification failed");
    return response.json();
}

export async function deleteMediaFile(fileId: string) {
    const response = await mediaRequest(fileId, "DELETE");
    // Retrying partial cleanup is safe when a previous request already removed a file.
    if (!response.ok && response.status !== 404) throw new Error("ImageKit cleanup failed");
}

// Shared files must not be attached to a new video while they are being deleted.
// MongoDB coordinates these short leases across Next.js workers and processes.
export async function withMediaLocks<T>(fileIds: string[], work: () => Promise<T>): Promise<T> {
    const locks = mongoose.connection.collection<{ _id: string; token: string; expiresAt: Date }>("video_asset_locks");
    await locks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    const token = randomUUID();
    const acquired: string[] = [];
    const expiresAt = new Date(Date.now() + 90000);
    try {
        for (const fileId of [...new Set(fileIds)].sort()) {
            await locks.deleteOne({ _id: fileId, expiresAt: { $lte: new Date() } });
            try {
                await locks.insertOne({ _id: fileId, token, expiresAt });
                acquired.push(fileId);
            } catch (error) {
                if (error && typeof error === "object" && "code" in error && error.code === 11000) throw new MediaBusyError();
                throw error;
            }
        }
        return await work();
    } finally {
        if (acquired.length) await locks.deleteMany({ _id: { $in: acquired }, token });
    }
}
