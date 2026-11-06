import "@/lib/auth/environment";
import {
  PUBLIC_PAGES,
  siteOrigin,
  validVideoId,
  videoPath,
} from "@/lib/seo/config";
import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const publicWatch = /^\/videos\/[a-f0-9]{24}$/i.test(pathname);
  const seoFile =
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/social-preview.png" ||
    /^\/sitemaps\/(pages|videos-(0|[1-9]\d{0,4}))\.xml$/.test(pathname);
  const indexable =
    pathname === "/icon.svg" ||
    PUBLIC_PAGES.some((path) => path === pathname) ||
    publicWatch ||
    seoFile;
  const preview =
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL_ENV === "preview" ||
    req.nextUrl.hostname !== new URL(siteOrigin()).hostname;
  const finish = (response: NextResponse) => {
    if (!indexable || preview || req.nextUrl.search)
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  };
  // These exact routes authenticate their own signed server-to-server requests.
  // Customer cookies never authorize administration; no generic /api/admin bypass.
  if (
    /^\/api\/admin\/v1\/[^/]+$/.test(pathname) ||
    /^\/api\/admin\/v1\/actions\/[a-f0-9-]{36}$/.test(pathname)
  )
    return finish(NextResponse.next());
  // Malformed/unknown administration paths never fall through to customer auth.
  if (pathname === "/api/admin" || pathname.startsWith("/api/admin/"))
    return finish(
      NextResponse.json(
        { error: "Not found" },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        },
      ),
    );
  const legacyVideo = req.nextUrl.searchParams.get("video");
  if (
    (pathname === "/" || pathname === "/reels") &&
    legacyVideo &&
    validVideoId(legacyVideo)
  ) {
    return finish(
      NextResponse.redirect(
        new URL(videoPath(legacyVideo.toLowerCase()), req.url),
        308,
      ),
    );
  }
  if (
    seoFile ||
    pathname.startsWith("/videos/") ||
    pathname.startsWith("/sitemaps/") ||
    pathname === "/" ||
    pathname === "/reels" ||
    pathname === "/icon.svg" ||
    pathname === "/email-logo.png" ||
    /^\/brands\/(pexels|pixabay)\.svg$/.test(pathname) ||
    /^\/brands\/(coverr|mixkit)\.png$/.test(pathname) ||
    /^\/(file|globe|next|vercel|window)\.svg$/.test(pathname) ||
    [
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/confirm-parent",
      "/terms",
      "/privacy",
      "/help",
    ].includes(pathname) ||
    pathname === "/api/auth" ||
    pathname === "/api/cron/email-blocklist" ||
    pathname.startsWith("/api/auth/") ||
    (req.method === "GET" &&
      (pathname === "/api/showcase" ||
        pathname === "/api/videos" ||
        pathname.startsWith("/api/videos/")))
  ) {
    return finish(NextResponse.next());
  }
  const token = await getToken({
    req,
    secret: process.env.REELOGRAM_NEXTAUTH_SECRET,
  });
  if (token) return finish(NextResponse.next());
  if (pathname.startsWith("/api/")) {
    return finish(
      NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    );
  }
  const login = new URL("/login", req.url);
  login.searchParams.set(
    "callbackUrl",
    req.nextUrl.pathname + req.nextUrl.search,
  );
  return finish(NextResponse.redirect(login));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
