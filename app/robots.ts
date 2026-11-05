import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo/config";
export default function robots(): MetadataRoute.Robots {
  return {
    // Account pages can be crawled to see noindex; robots.txt is not access control.
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
