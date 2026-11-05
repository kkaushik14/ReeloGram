import { absoluteUrl, PUBLIC_PAGES, videoPath, xml } from "./config";

const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
export const sitemapHeaders = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export function sitemapIndex(pages: number) {
  const files = [
    "pages.xml",
    ...Array.from({ length: pages }, (_, i) => `videos-${i}.xml`),
  ];
  return `${declaration}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.map((file) => `<sitemap><loc>${absoluteUrl(`/sitemaps/${file}`)}</loc></sitemap>`).join("")}</sitemapindex>`;
}
export function pagesSitemap() {
  return `${declaration}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${PUBLIC_PAGES.map((path) => `<url><loc>${absoluteUrl(path)}</loc></url>`).join("")}</urlset>`;
}
type SitemapVideo = {
  _id?: unknown;
  title: string;
  description: string;
  videoUrl: string;
  thumbNailUrl: string;
  createdAt?: Date;
  updatedAt?: Date;
};
export function videosSitemap(videos: SitemapVideo[]) {
  return `${declaration}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">${videos
    .map((video) => {
      const modified = video.updatedAt ?? video.createdAt;
      return `<url><loc>${absoluteUrl(videoPath(String(video._id)))}</loc>${modified ? `<lastmod>${modified.toISOString()}</lastmod>` : ""}<video:video><video:thumbnail_loc>${xml(video.thumbNailUrl)}</video:thumbnail_loc><video:title>${xml(Array.from(video.title).slice(0, 100).join(""))}</video:title><video:description>${xml(video.description)}</video:description><video:content_loc>${xml(video.videoUrl)}</video:content_loc>${video.createdAt ? `<video:publication_date>${video.createdAt.toISOString()}</video:publication_date>` : ""}</video:video></url>`;
    })
    .join("")}</urlset>`;
}
