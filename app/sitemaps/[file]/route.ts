import Video, { type InterFVideo } from "@/models/Video";
import { connectToDatabase } from "@/lib/db";
import { PUBLIC_VIDEO_FILTER } from "@/lib/seo/config";
import { SITEMAP_PAGE_SIZE, VIDEO_SEO_FIELDS } from "@/lib/seo/videos";
import {
  pagesSitemap,
  videosSitemap,
  sitemapHeaders,
} from "@/lib/seo/sitemaps";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (file === "pages.xml")
    return new Response(pagesSitemap(), { headers: sitemapHeaders });
  const match = /^videos-(0|[1-9]\d{0,4})\.xml$/.exec(file);
  if (!match) return new Response("Not found", { status: 404 });
  try {
    await connectToDatabase();
    const page = Number(match[1]);
    const count =
      await Video.countDocuments(PUBLIC_VIDEO_FILTER).maxTimeMS(5000);
    if (page >= Math.ceil(count / SITEMAP_PAGE_SIZE))
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    const videos = await Video.find(PUBLIC_VIDEO_FILTER)
      .select(VIDEO_SEO_FIELDS)
      .sort({ _id: 1 })
      .skip(page * SITEMAP_PAGE_SIZE)
      .limit(SITEMAP_PAGE_SIZE)
      .maxTimeMS(5000)
      .lean<InterFVideo[]>();
    return new Response(videosSitemap(videos), { headers: sitemapHeaders });
  } catch {
    return new Response("Sitemap temporarily unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    });
  }
}
