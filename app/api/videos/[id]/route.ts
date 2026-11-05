import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-opt";
import { connectToDatabase } from "@/lib/db";
import { parseVideoUpdate } from "@/lib/video-input";
import { serializeVideo } from "@/lib/video-response";
import { deleteMediaFile, MediaBusyError, withMediaLocks } from "@/lib/video-media";
import Video from "@/models/Video";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

async function authorize(context: Context) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { error: errorResponse("Authentication required", 401) };
    const { id } = await context.params;
    if (!/^[a-f0-9]{24}$/i.test(id)) return { error: errorResponse("Invalid video ID", 400) };
    await connectToDatabase();
    const video = await Video.findById(id);
    if (!video) return { error: errorResponse("Video not found", 404) };
    if (video.uploadedBy?.toString() !== session.user.id) return { error: errorResponse("Only the uploader can modify this video", 403) };
    return { video, owner: session.user.id, id };
}

export async function PATCH(req: Request, context: Context) {
    try {
        const result = await authorize(context);
        if (result.error) return result.error;
        let body: unknown;
        try { body = await req.json(); } catch { return errorResponse("Invalid JSON", 400); }
        const update = parseVideoUpdate(body);
        if (!update) return errorResponse("Only valid title, description and controls fields may be edited", 400);
        const video = await Video.findOneAndUpdate({ _id: result.id, uploadedBy: result.owner, deletionPending: { $ne: true } },
            { $set: update }, { new: true, runValidators: true });
        if (!video) return errorResponse("Video deletion is in progress", 409);
        return NextResponse.json(serializeVideo(video), { headers });
    } catch (error) {
        console.error("Video update failed", error instanceof Error ? error.name : "Unknown error");
        return errorResponse("Video editing is temporarily unavailable", 503);
    }
}

export async function DELETE(_req: Request, context: Context) {
    try {
        const result = await authorize(context);
        if (result.error) return result.error;
        const { fileId, thumbnailFileId } = result.video;
        if (!fileId || !thumbnailFileId) return errorResponse("Video is missing tracked ImageKit file IDs", 409);
        return await withMediaLocks([fileId, thumbnailFileId], async () => {
            const video = await Video.findOneAndUpdate({ _id: result.id, uploadedBy: result.owner },
                { $set: { deletionPending: true } }, { new: true });
            if (!video) return errorResponse("Video not found", 404);
            for (const assetId of new Set<string>([fileId, thumbnailFileId])) {
                const shared = await Video.exists({ _id: { $ne: result.id }, $or: [{ fileId: assetId }, { thumbnailFileId: assetId }] });
                if (!shared) await deleteMediaFile(assetId);
            }
            await Video.deleteOne({ _id: result.id, uploadedBy: result.owner, deletionPending: true });
            return new NextResponse(null, { status: 204, headers });
        });
    } catch (error) {
        if (error instanceof MediaBusyError) return errorResponse("Media files are busy; retry the request", 409);
        console.error("Video deletion failed", error instanceof Error ? error.name : "Unknown error");
        return errorResponse("Video cleanup is incomplete; retry deletion", 503);
    }
}
