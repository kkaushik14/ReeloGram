import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Video, { type InterFVideo } from "@/models/Video";
import { serializeVideo } from "@/lib/video-response";
import { limitRequest, rateLimitResponse } from "@/lib/security/rate-limit";
import { readPublicData } from "@/lib/cache/public-data";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    await limitRequest("showcase", null, req.headers);
    const data = await readPublicData("showcase", async () => {
      await connectToDatabase();
      const records = await Video.find({
        placement: "hero",
        deletionPending: { $ne: true },
      })
        .sort({ createdAt: -1 })
        .limit(4)
        .lean<InterFVideo[]>();
      return { videos: records.map(serializeVideo) };
    });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return (
      rateLimitResponse(error) ??
      NextResponse.json(
        { error: "The video preview is temporarily unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      )
    );
  }
}
