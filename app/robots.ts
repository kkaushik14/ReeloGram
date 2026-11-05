import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo/config";
export default function robots(): MetadataRoute.Robots {
  return {
    // Account pages can be crawled to see noindex; robots.txt is not access control.
    rules: {
      userAgent: "*",
      // These public GET routes are needed to render Browse and Reels.
      // API responses themselves carry noindex; authorization still protects mine=true.
      allow: ["/", "/api/videos", "/api/showcase"],
      disallow: "/api/",
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
