import type { Metadata } from "next";
import { absoluteUrl, SITE_NAME } from "./config";

export function pageMetadata(
  title: string,
  description: string,
  path: string,
  image = absoluteUrl("/social-preview.png"),
): Metadata {
  return {
    title: { absolute: `${title} — ${SITE_NAME}` },
    description,
    alternates: { canonical: absoluteUrl(path) },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-video-preview": -1,
      },
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description,
      url: absoluteUrl(path),
      images: [{ url: image, alt: title }],
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
