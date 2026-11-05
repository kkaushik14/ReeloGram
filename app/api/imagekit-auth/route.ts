import ImageKit from "imagekit";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-opt";

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const publicKey = process.env.NEXT_PUBLIC_PUBLIC_KEY;
    const privateKey = process.env.PRIVATE_KEY;
    const urlEndpoint = process.env.NEXT_PUBLIC_URL_ENDPOINT;
    if (!publicKey || !privateKey || !urlEndpoint) {
        return NextResponse.json({ error: "Uploads are not configured" }, { status: 503 });
    }
    const imagekit = new ImageKit({ publicKey, privateKey, urlEndpoint });
    return NextResponse.json(imagekit.getAuthenticationParameters(), {
        headers: { "Cache-Control": "no-store" },
    });
}
