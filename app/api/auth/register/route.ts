import { NextResponse } from "next/server";
import { parseCredentials } from "@/lib/credentials";
import { connectToDatabase } from "@/lib/db";
import User from "@/models/User";

export async function POST(req: Request) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const credentials = parseCredentials(body);
    if (!credentials || credentials.password.length < 8) {
        return NextResponse.json({ error: "Provide a valid email and a password of at least 8 characters, up to 72 UTF-8 bytes." }, { status: 400 });
    }
    try {
        await connectToDatabase();
        // Wait for the unique email index before accepting registrations.
        await User.init();
        await User.create(credentials);
        return NextResponse.json({ message: "Account created" }, { status: 201 });
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === 11000) {
            return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
        }
        console.error("Account registration failed", error instanceof Error ? error.name : "Unknown error");
        return NextResponse.json({ error: "Registration is unavailable. Please try again later." }, { status: 503 });
    }
}
