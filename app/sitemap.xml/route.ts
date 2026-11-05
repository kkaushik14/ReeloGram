import Video from "@/models/Video";
import { connectToDatabase } from "@/lib/db";
import { PUBLIC_VIDEO_FILTER } from "@/lib/seo/config";
import { SITEMAP_PAGE_SIZE } from "@/lib/seo/videos";
import { sitemapHeaders, sitemapIndex } from "@/lib/seo/sitemaps";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await connectToDatabase();
    const count =
      await Video.countDocuments(PUBLIC_VIDEO_FILTER).maxTimeMS(5000);
    return new Response(sitemapIndex(Math.ceil(count / SITEMAP_PAGE_SIZE)), {
      headers: sitemapHeaders,
    });
  } catch {
    // Never tell crawlers that every video vanished during a database outage.
    return new Response("Sitemap temporarily unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    });
  }
}
