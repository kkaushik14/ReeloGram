import { publishVerifiedVideo } from "@/lib/uploads/publish-server";
import { readFeed } from "@/lib/cache/feed";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose, { type FilterQuery } from "mongoose";
import { authOptions } from "@/lib/auth-opt";
import { connectToDatabase } from "@/lib/db";
import { limitRequest, rateLimitResponse } from "@/lib/security/rate-limit";
import { readAuthJson, authFailure } from "@/lib/auth/request";
import { parseFeedQuery, parseVideoInput } from "@/lib/video-input";
import { publishingAccessError } from "@/lib/account/access";
import { PUBLIC_VIDEO_FILTER } from "@/lib/seo/config";
import { presentVideos } from "@/lib/video-presenter";
import Video, { type InterFVideo } from "@/models/Video";

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
    const result = await readFeed(query, async () => {
      await connectToDatabase();
      const direction = query.sort === "oldest" ? 1 : -1;
      const comparison = direction === 1 ? "$gt" : "$lt";
      const conditions: FilterQuery<InterFVideo>[] = [
        mine
          ? {
              deletionPending: { $ne: true },
              $or: [{ placement: "feed" }, { placement: { $exists: false } }],
            }
          : PUBLIC_VIDEO_FILTER,
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
              _id: {
                [comparison]: new mongoose.Types.ObjectId(query.cursor.id),
              },
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
      return { videos: await presentVideos(page), nextCursor, total };
    });
    return NextResponse.json(result, { headers });
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
  const accessError = publishingAccessError(session.user);
  if (accessError)
    return NextResponse.json({ error: accessError }, { status: 403, headers });
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
  return publishVerifiedVideo(input, session.user);
}
