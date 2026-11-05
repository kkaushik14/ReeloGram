import "@/lib/auth/environment";
import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;
    if (pathname === "/" || pathname === "/reels" || pathname === "/icon.svg" || /^\/brands\/(pexels|pixabay)\.svg$/.test(pathname) || /^\/brands\/(coverr|mixkit)\.png$/.test(pathname) || /^\/(file|globe|next|vercel|window)\.svg$/.test(pathname) ||
        ["/login","/register","/forgot-password","/reset-password","/terms","/privacy","/help"].includes(pathname) ||
        pathname === "/api/auth" || pathname.startsWith("/api/auth/") ||
        (req.method === "GET" && (pathname === "/api/showcase" || pathname === "/api/videos" || pathname.startsWith("/api/videos/")))) {
        return NextResponse.next();
    }
    const token = await getToken({ req, secret: process.env.REELOGRAM_NEXTAUTH_SECRET });
    if (token) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const login = new URL("/login", req.url);
    login.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
