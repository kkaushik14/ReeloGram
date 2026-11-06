import { withPublishingAccount } from "@/lib/account/publishing-guard";
import { AuthRequestError, authFailure } from "@/lib/auth/request";
import { ownsUpload } from "@/lib/uploads/authorization";
import { namedUpload } from "@/lib/uploads/naming";
import { withPublicDataMutation } from "@/lib/cache/public-data";
import { after, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { parseVideoInput } from "@/lib/video-input";
import User from "@/models/User";
import { queueAccountEmail } from "@/lib/email/account";
import { videoPostedEmail } from "@/lib/email/templates";
import { appOrigin } from "@/lib/email/transport";
import { prepareVideoPlayback } from "@/lib/video-preparation";
import {
  publishMediaError,
  publishedVideoUrl,
} from "@/lib/uploads/publish-media";
import { presentVideos } from "@/lib/video-presenter";
import {
  getMediaFile,
  MediaBusyError,
  MediaNotFoundError,
  withMediaLocks,
} from "@/lib/video-media";
import Video, { VIDEO_DIMENSION } from "@/models/Video";

const headers = { "Cache-Control": "no-store" };

export async function publishVerifiedVideo(
  input: NonNullable<ReturnType<typeof parseVideoInput>>,
  identity: { id: string; sessionVersion: number },
  beforeSave?: (transaction: import("mongoose").ClientSession) => Promise<void>,
) {
  const publicKey = process.env.NEXT_PUBLIC_REELOGRAM_PUBLIC_KEY;
  const privateKey = process.env.REELOGRAM_PRIVATE_KEY;
  const urlEndpoint = process.env.NEXT_PUBLIC_REELOGRAM_URL_ENDPOINT;
  if (!publicKey || !privateKey || !urlEndpoint)
    return NextResponse.json(
      { error: "Uploads are not configured" },
      { status: 503 },
    );
  try {
    await connectToDatabase();
    return await withMediaLocks(
      [input.fileId, input.thumbnailFileId],
      async () => {
        const existing = await Video.findOne({ fileId: input.fileId });
        if (existing) {
          // A lost response must not force another upload or duplicate a post.
          if (
            !existing.deletionPending &&
            String(existing.uploadedBy) === identity.id &&
            existing.thumbnailFileId === input.thumbnailFileId &&
            existing.title === input.title &&
            existing.description === input.description &&
            existing.controls === input.controls
          )
            return NextResponse.json((await presentVideos([existing]))[0], {
              headers,
            });
          return NextResponse.json(
            {
              error:
                "This video has already been saved. Check Your videos before trying again.",
            },
            { status: 409, headers },
          );
        }
        let videoFile, thumbnail;
        try {
          [videoFile, thumbnail] = await Promise.all([
            getMediaFile(input.fileId),
            getMediaFile(input.thumbnailFileId),
          ]);
        } catch (error) {
          const missing = error instanceof MediaNotFoundError;
          return NextResponse.json(
            {
              error: missing
                ? "Uploaded file not found"
                : "Unable to verify uploaded files",
            },
            { status: missing ? 404 : 503 },
          );
        }
        if (
          !ownsUpload(videoFile, identity.id, "video") ||
          !ownsUpload(thumbnail, identity.id, "image")
        )
          return NextResponse.json(
            { error: "Upload your video and cover again from this account." },
            { status: 403, headers },
          );
        const mediaError = publishMediaError(videoFile, thumbnail);
        if (mediaError) {
          console.warn("Publish rejected", {
            reason: "media_validation",
            videoMime: videoFile.mime,
            coverMime: thumbnail.mime,
          });
          return NextResponse.json(
            { error: mediaError },
            { status: 400, headers },
          );
        }
        const videoUrl = publishedVideoUrl(videoFile, urlEndpoint);
        try {
          await connectToDatabase();
          await Video.init();
          const video = await withPublicDataMutation(() =>
            withPublishingAccount(
              identity.id,
              identity.sessionVersion,
              async (transaction) => {
                if (beforeSave) await beforeSave(transaction);
                const document = new Video({
                  ...input,
                  // New grants reserve the actual post ID in the signed filename.
                  // Legacy owned uploads still receive a normal generated ObjectId.
                  _id: namedUpload(videoFile.filePath, identity.id, "video")
                    ?.videoId,
                  uploadedBy: identity.id,
                  videoUrl,
                  thumbNailUrl: thumbnail.url,
                  transformatioon: {
                    width: videoFile.width || VIDEO_DIMENSION.width,
                    height: videoFile.height || VIDEO_DIMENSION.height,
                  },
                });
                return document.save({ session: transaction, maxTimeMS: 5000 });
              },
            ),
          );
          const presented = (await presentVideos([video]))[0];
          after(async () => {
            await prepareVideoPlayback(videoUrl, presented.transformation);
            try {
              const owner = await User.findById(identity.id).select("email");
              if (owner) {
                await queueAccountEmail(
                  identity.id,
                  videoPostedEmail(
                    owner.email,
                    presented.title,
                    `${appOrigin()}/videos/${presented.id}`,
                  ),
                  `video-posted:${presented.id}`,
                );
              }
            } catch {
              console.error("Video confirmation email could not be queued");
            }
          });
          return NextResponse.json(presented, { status: 201, headers });
        } catch (error) {
          if (error instanceof AuthRequestError) return authFailure(error);
          const protection = rateLimitResponse(error);
          if (protection) return protection;
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === 11000
          ) {
            return NextResponse.json(
              { error: "This video has already been saved" },
              { status: 409 },
            );
          }
          console.error(
            "Video save failed",
            error instanceof Error ? error.name : "Unknown error",
          );
          return NextResponse.json(
            { error: "Video saving is temporarily unavailable" },
            { status: 503 },
          );
        }
      },
    );
  } catch (error) {
    if (error instanceof MediaBusyError)
      return NextResponse.json(
        { error: "Media files are busy; retry the request" },
        { status: 409 },
      );
    const protection = rateLimitResponse(error);
    if (protection) return protection;
    return NextResponse.json(
      { error: "Video saving is temporarily unavailable" },
      { status: 503 },
    );
  }
}
