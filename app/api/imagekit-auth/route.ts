import { createUploadAuthorization } from "@/lib/uploads/authorization";
import { assertSameOrigin, authFailure } from "@/lib/auth/request";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-opt";
import { publishingAccessError } from "@/lib/account/access";
import { limitRequest, rateLimitResponse } from "@/lib/security/rate-limit";

export async function GET(req: Request) {
  try {
    assertSameOrigin(req);
    const session = await getServerSession(authOptions);
    if (!session)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    const accessError = publishingAccessError(session.user);
    if (accessError)
      return NextResponse.json(
        { error: accessError },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    const publicKey = process.env.NEXT_PUBLIC_REELOGRAM_PUBLIC_KEY;
    const privateKey = process.env.REELOGRAM_PRIVATE_KEY;
    const urlEndpoint = process.env.NEXT_PUBLIC_REELOGRAM_URL_ENDPOINT;
    if (!publicKey || !privateKey || !urlEndpoint) {
      return NextResponse.json(
        { error: "Uploads are not configured" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    try {
      await limitRequest("upload", session.user.id, req.headers);
      const kind = new URL(req.url).searchParams.get("kind") ?? "video";
      if (kind !== "image" && kind !== "video")
        return NextResponse.json(
          { error: "Invalid upload type" },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      return NextResponse.json(
        createUploadAuthorization(session.user.id, kind, publicKey, privateKey),
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    } catch (error) {
      const limited = rateLimitResponse(error);
      if (limited) return limited;
      console.error(
        "Upload authentication failed",
        error instanceof Error ? error.name : "Unknown error",
      );
      return NextResponse.json(
        { error: "Uploads are not configured correctly" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch (error) {
    return authFailure(error);
  }
}
