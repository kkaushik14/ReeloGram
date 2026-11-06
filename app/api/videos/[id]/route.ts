import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-opt";
import { connectToDatabase } from "@/lib/db";
import { parseVideoUpdate } from "@/lib/video-input";
import { presentVideos } from "@/lib/video-presenter";
import {
  deleteMediaFile,
  MediaBusyError,
  withMediaLocks,
} from "@/lib/video-media";
import Video from "@/models/Video";
import { PUBLIC_VIDEO_FILTER } from "@/lib/seo/config";
import User from "@/models/User";
import { limitRequest, rateLimitResponse } from "@/lib/security/rate-limit";
import {
  readAuthJson,
  assertSameOrigin,
  AuthRequestError,
} from "@/lib/auth/request";
import { withPublicDataMutation } from "@/lib/cache/public-data";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers });

export async function GET(req: Request, context: Context) {
  const { id } = await context.params;
  if (!/^[a-f0-9]{24}$/i.test(id))
    return errorResponse("Invalid video ID", 400);
  try {
    await limitRequest("feed", null, req.headers);
    await connectToDatabase();
    const video = await Video.findOne({
      _id: id,
      ...PUBLIC_VIDEO_FILTER,
    });
    if (!video) return errorResponse("Video not found", 404);
    return NextResponse.json((await presentVideos([video]))[0], { headers });
  } catch (error) {
    return (
      rateLimitResponse(error) ??
      errorResponse("Video is temporarily unavailable", 503)
    );
  }
}

async function authorize(context: Context, req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return { error: errorResponse("Authentication required", 401) };
  assertSameOrigin(req);
  await limitRequest("mutation", session.user.id, req.headers);
  const { id } = await context.params;
  if (!/^[a-f0-9]{24}$/i.test(id))
    return { error: errorResponse("Invalid video ID", 400) };
  await connectToDatabase();
  const video = await Video.findById(id);
  if (!video) return { error: errorResponse("Video not found", 404) };
  if (video.uploadedBy?.toString() !== session.user.id)
    return {
      error: errorResponse("Only the uploader can modify this video", 403),
    };
  return { video, owner: session.user.id, id };
}

export async function PATCH(req: Request, context: Context) {
  try {
    const result = await authorize(context, req);
    if (result.error) return result.error;
    let body: unknown;
    try {
      body = await readAuthJson(req);
    } catch (error) {
      if (error instanceof AuthRequestError)
        return errorResponse(error.message, error.status);
      throw error;
    }
    const update = parseVideoUpdate(body);
    if (!update)
      return errorResponse(
        "Only valid title, description and controls fields may be edited",
        400,
      );
    const video = await withPublicDataMutation(async () =>
      Video.findOneAndUpdate(
        {
          _id: result.id,
          uploadedBy: result.owner,
          deletionPending: { $ne: true },
        },
        { $set: update },
        { new: true, runValidators: true, maxTimeMS: 10000 },
      ),
    );
    if (!video) return errorResponse("Video deletion is in progress", 409);
    return NextResponse.json((await presentVideos([video]))[0], { headers });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof AuthRequestError)
      return errorResponse(error.message, error.status);
    console.error(
      "Video update failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    return errorResponse("Video editing is temporarily unavailable", 503);
  }
}

export async function DELETE(req: Request, context: Context) {
  try {
    const result = await authorize(context, req);
    if (result.error) return result.error;
    const { fileId, thumbnailFileId } = result.video;
    if (!fileId || !thumbnailFileId)
      return errorResponse("Video is missing tracked ImageKit file IDs", 409);
    return await withMediaLocks([fileId, thumbnailFileId], async () => {
      const video = await withPublicDataMutation(async () =>
        Video.findOneAndUpdate(
          { _id: result.id, uploadedBy: result.owner },
          { $set: { deletionPending: true } },
          { new: true, maxTimeMS: 10000 },
        ),
      );
      if (!video) return errorResponse("Video not found", 404);
      for (const assetId of new Set<string>([fileId, thumbnailFileId])) {
        const shared = await Video.exists({
          _id: { $ne: result.id },
          $or: [{ fileId: assetId }, { thumbnailFileId: assetId }],
        });
        const profile = await User.exists({ imageFileId: assetId });
        if (!shared && !profile) await deleteMediaFile(assetId);
      }
      await withPublicDataMutation(async () =>
        Video.deleteOne(
          {
            _id: result.id,
            uploadedBy: result.owner,
            deletionPending: true,
          },
          { maxTimeMS: 10000 },
        ),
      );
      return new NextResponse(null, { status: 204, headers });
    });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof AuthRequestError)
      return errorResponse(error.message, error.status);
    if (error instanceof MediaBusyError)
      return errorResponse("Media files are busy; retry the request", 409);
    console.error(
      "Video deletion failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    return errorResponse("Video cleanup is incomplete; retry deletion", 503);
  }
}
