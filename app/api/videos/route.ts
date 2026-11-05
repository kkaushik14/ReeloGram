import { after, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose, { type FilterQuery } from "mongoose";
import { authOptions } from "@/lib/auth-opt";
import { connectToDatabase } from "@/lib/db";
import { limitRequest, rateLimitResponse } from "@/lib/security/rate-limit";
import { readAuthJson, authFailure } from "@/lib/auth/request";
import { parseFeedQuery, parseVideoInput } from "@/lib/video-input";
import User from "@/models/User";
import { queueEmail, deliverQueuedEmails } from "@/lib/email/outbox";
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
import Video, { VIDEO_DIMENSION, type InterFVideo } from "@/models/Video";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const query = parseFeedQuery(new URL(req.url).searchParams);
  if (!query)
    return NextResponse.json(
      { error: "Invalid feed filters or cursor" },
      { status: 400, headers },
    );
  const mine = query.mine;
  const session = mine ? await getServerSession(authOptions) : null;
  if (mine && !session?.user?.id)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401, headers },
    );
  try {
    await limitRequest("feed", mine ? session!.user.id : null, req.headers);
    await connectToDatabase();
    const direction = query.sort === "oldest" ? 1 : -1;
    const comparison = direction === 1 ? "$gt" : "$lt";
    const conditions: FilterQuery<InterFVideo>[] = [
      { deletionPending: { $ne: true } },
      { placement: { $nin: ["hero", "archived"] } },
    ];
    if (mine) conditions.push({ uploadedBy: session!.user.id });
    const providers: Record<string, string> = {
      pexels: "Pexels",
      pixabay: "Pixabay",
      coverr: "Coverr",
      mixkit: "Mixkit",
    };
    if (providers[query.source])
      conditions.push({ "source.provider": providers[query.source] });
    if (query.source === "community")
      conditions.push({ source: { $exists: false } });
    if (query.q) {
      const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      conditions.push({
        $or: [
          { title: { $regex: escaped, $options: "i" } },
          { description: { $regex: escaped, $options: "i" } },
          { "source.creator": { $regex: escaped, $options: "i" } },
        ],
      });
    }
    if (query.period !== "any") {
      const days =
        query.period === "week" ? 7 : query.period === "month" ? 30 : 365;
      conditions.push({
        createdAt: { $gte: new Date(Date.now() - days * 86400000) },
      });
    }
    const countFilter = { $and: [...conditions] };
    if (query.cursor)
      conditions.push({
        $or: [
          { createdAt: { [comparison]: query.cursor.createdAt } },
          {
            createdAt: query.cursor.createdAt,
            _id: { [comparison]: new mongoose.Types.ObjectId(query.cursor.id) },
          },
        ],
      });
    const [records, total] = await Promise.all([
      Video.find({ $and: conditions })
        .sort({ createdAt: direction, _id: direction })
        .limit(query.limit + 1)
        .lean<InterFVideo[]>(),
      Video.countDocuments(countFilter),
    ]);
    const page = records.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor =
      records.length > query.limit && last
        ? Buffer.from(
            JSON.stringify({
              id: last._id!.toString(),
              createdAt: last.createdAt,
              context: query.context,
            }),
          ).toString("base64url")
        : null;
    return NextResponse.json(
      { videos: await presentVideos(page), nextCursor, total },
      { headers },
    );
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    console.error(
      "Video feed failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    return NextResponse.json(
      { error: "Video feed is temporarily unavailable" },
      { status: 503, headers },
    );
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  let body: unknown;
  try {
    await limitRequest("publish", session.user.id, req.headers);
    body = await readAuthJson(req);
  } catch (error) {
    return authFailure(
      error,
      "Video saving is temporarily unavailable. Please try again later.",
    );
  }
  const input = parseVideoInput(body);
  if (!input)
    return NextResponse.json(
      {
        error:
          "Provide title (1–120 characters), description (1–2000), fileId, thumbnailFileId, and optional boolean controls",
      },
      { status: 400 },
    );
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
            String(existing.uploadedBy) === session.user.id &&
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
          const video = await Video.create({
            ...input,
            uploadedBy: session.user.id,
            videoUrl,
            thumbNailUrl: thumbnail.url,
            transformatioon: {
              width: videoFile.width || VIDEO_DIMENSION.width,
              height: videoFile.height || VIDEO_DIMENSION.height,
            },
          });
          const presented = (await presentVideos([video]))[0];
          after(async () => {
            await prepareVideoPlayback(videoUrl, presented.transformation);
            try {
              const owner = await User.findById(session.user.id).select(
                "email",
              );
              if (owner) {
                const id = await queueEmail(
                  videoPostedEmail(
                    owner.email,
                    presented.title,
                    `${appOrigin()}/?video=${presented.id}`,
                  ),
                  `video-posted:${presented.id}`,
                );
                await deliverQueuedEmails(id);
              }
            } catch {
              console.error("Video confirmation email could not be queued");
            }
          });
          return NextResponse.json(presented, { status: 201, headers });
        } catch (error) {
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
    return NextResponse.json(
      { error: "Video saving is temporarily unavailable" },
      { status: 503 },
    );
  }
}
