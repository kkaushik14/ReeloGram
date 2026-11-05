import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose, { type FilterQuery } from "mongoose";
import { authOptions } from "@/lib/auth-opt";
import { connectToDatabase } from "@/lib/db";
import { parseFeedQuery, parseVideoInput } from "@/lib/video-input";
import { serializeVideo as serialize } from "@/lib/video-response";
import { getMediaFile, MediaBusyError, MediaNotFoundError, withMediaLocks } from "@/lib/video-media";
import Video, { VIDEO_DIMENSION, type InterFVideo } from "@/models/Video";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
    const query = parseFeedQuery(new URL(req.url).searchParams);
    if (!query) return NextResponse.json({ error: "Invalid feed filters or cursor" }, { status: 400, headers });
    const mine = query.mine;
    const session = mine ? await getServerSession(authOptions) : null;
    if (mine && !session?.user?.id) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers });
    try {
        await connectToDatabase();
        const direction = query.sort === "oldest" ? 1 : -1;
        const comparison = direction === 1 ? "$gt" : "$lt";
        const conditions: FilterQuery<InterFVideo>[] = [{ deletionPending: { $ne: true } },{placement:{$ne:"hero"}}];
        if (mine) conditions.push({ uploadedBy: session!.user.id });
        const providers: Record<string,string> = {pexels:"Pexels",pixabay:"Pixabay",coverr:"Coverr",mixkit:"Mixkit"};
        if (providers[query.source]) conditions.push({ "source.provider": providers[query.source] });
        if (query.source === "community") conditions.push({ source: { $exists: false } });
        if (query.q) {
            const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            conditions.push({ $or: [{ title: { $regex: escaped, $options: "i" } }, { description: { $regex: escaped, $options: "i" } }, { "source.creator": { $regex: escaped, $options: "i" } }] });
        }
        if (query.period !== "any") {
            const days = query.period === "week" ? 7 : query.period === "month" ? 30 : 365;
            conditions.push({ createdAt: { $gte: new Date(Date.now() - days * 86400000) } });
        }
        const countFilter = { $and: [...conditions] };
        if (query.cursor) conditions.push({ $or: [
            { createdAt: { [comparison]: query.cursor.createdAt } },
            { createdAt: query.cursor.createdAt, _id: { [comparison]: new mongoose.Types.ObjectId(query.cursor.id) } },
        ] });
        const [records, total] = await Promise.all([
            Video.find({ $and: conditions }).sort({ createdAt: direction, _id: direction }).limit(query.limit + 1).lean<InterFVideo[]>(),
            Video.countDocuments(countFilter),
        ]);
        const page = records.slice(0, query.limit);
        const last = page.at(-1);
        const nextCursor = records.length > query.limit && last ? Buffer.from(JSON.stringify({
            id: last._id!.toString(), createdAt: last.createdAt, context: query.context,
        })).toString("base64url") : null;
        return NextResponse.json({ videos: page.map(serialize), nextCursor, total }, { headers });
    } catch (error) {
        console.error("Video feed failed", error instanceof Error ? error.name : "Unknown error");
        return NextResponse.json({ error: "Video feed is temporarily unavailable" }, { status: 503, headers });
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    let body: unknown;
    try { body = await req.json(); } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const input = parseVideoInput(body);
    if (!input) return NextResponse.json({ error: "Provide title (1–120 characters), description (1–2000), fileId, thumbnailFileId, and optional boolean controls" }, { status: 400 });
    const publicKey = process.env.NEXT_PUBLIC_PUBLIC_KEY;
    const privateKey = process.env.PRIVATE_KEY;
    const urlEndpoint = process.env.NEXT_PUBLIC_URL_ENDPOINT;
    if (!publicKey || !privateKey || !urlEndpoint) return NextResponse.json({ error: "Uploads are not configured" }, { status: 503 });
    try {
        await connectToDatabase();
        return await withMediaLocks([input.fileId, input.thumbnailFileId], async () => {
            let videoFile, thumbnail;
            try {
                [videoFile, thumbnail] = await Promise.all([
                    getMediaFile(input.fileId), getMediaFile(input.thumbnailFileId),
                ]);
            } catch (error) {
                const missing = error instanceof MediaNotFoundError;
                return NextResponse.json({ error: missing ? "Uploaded file not found" : "Unable to verify uploaded files" }, { status: missing ? 404 : 503 });
            }
            if (!videoFile.mime?.startsWith("video/") || videoFile.size <= 0 || videoFile.size > 100 * 1024 * 1024 ||
                !["image/jpeg", "image/png", "image/webp"].includes(thumbnail.mime ?? "") || thumbnail.size <= 0 || thumbnail.size > 5 * 1024 * 1024 ||
                videoFile.isPrivateFile || thumbnail.isPrivateFile) {
                return NextResponse.json({ error: "A public video up to 100 MB and a public JPEG, PNG or WebP thumbnail up to 5 MB are required" }, { status: 400 });
            }
            try {
                await connectToDatabase();
                await Video.init();
                const video = await Video.create({
                    ...input, uploadedBy: session.user.id, videoUrl: videoFile.url, thumbNailUrl: thumbnail.url,
                    transformatioon: VIDEO_DIMENSION,
                });
                return NextResponse.json(serialize(video), { status: 201, headers });
            } catch (error) {
                if (error && typeof error === "object" && "code" in error && error.code === 11000) {
                    return NextResponse.json({ error: "This video has already been saved" }, { status: 409 });
                }
                console.error("Video save failed", error instanceof Error ? error.name : "Unknown error");
                return NextResponse.json({ error: "Video saving is temporarily unavailable" }, { status: 503 });
            }
        });
    } catch (error) {
        if (error instanceof MediaBusyError) return NextResponse.json({ error: "Media files are busy; retry the request" }, { status: 409 });
        return NextResponse.json({ error: "Video saving is temporarily unavailable" }, { status: 503 });
    }
}
