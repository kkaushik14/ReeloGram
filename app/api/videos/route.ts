import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import ImageKit from "imagekit";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth-opt";
import { connectToDatabase } from "@/lib/db";
import { parseFeedQuery, parseVideoInput } from "@/lib/video-input";
import Video, { VIDEO_DIMENSION, type InterFVideo } from "@/models/Video";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function serialize(video: InterFVideo) {
    return {
        id: video._id!.toString(), title: video.title, description: video.description,
        fileId: video.fileId, thumbnailFileId: video.thumbnailFileId,
        videoUrl: video.videoUrl, thumbnailUrl: video.thumbNailUrl, controls: video.controls,
        transformation: video.transformatioon, uploadedBy: video.uploadedBy?.toString(),
        createdAt: video.createdAt, updatedAt: video.updatedAt,
    };
}

export async function GET(req: Request) {
    const query = parseFeedQuery(new URL(req.url).searchParams);
    if (!query) return NextResponse.json({ error: "Invalid limit or cursor" }, { status: 400, headers });
    try {
        await connectToDatabase();
        const filter = query.cursor ? { $or: [
            { createdAt: { $lt: query.cursor.createdAt } },
            { createdAt: query.cursor.createdAt, _id: { $lt: new mongoose.Types.ObjectId(query.cursor.id) } },
        ] } : {};
        const records = await Video.find(filter).sort({ createdAt: -1, _id: -1 }).limit(query.limit + 1).lean<InterFVideo[]>();
        const page = records.slice(0, query.limit);
        const last = page.at(-1);
        const nextCursor = records.length > query.limit && last ? Buffer.from(JSON.stringify({
            id: last._id!.toString(), createdAt: last.createdAt,
        })).toString("base64url") : null;
        return NextResponse.json({ videos: page.map(serialize), nextCursor }, { headers });
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
    let videoFile, thumbnail;
    try {
        const imagekit = new ImageKit({ publicKey, privateKey, urlEndpoint });
        [videoFile, thumbnail] = await Promise.all([
            imagekit.getFileDetails(input.fileId), imagekit.getFileDetails(input.thumbnailFileId),
        ]);
    } catch (error) {
        const metadata = error && typeof error === "object" && "$ResponseMetadata" in error ? error.$ResponseMetadata : null;
        const missing = metadata && typeof metadata === "object" && "statusCode" in metadata && metadata.statusCode === 404;
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
}
