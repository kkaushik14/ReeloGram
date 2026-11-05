import "@/lib/auth/environment";
import type { Metadata } from "next";
import { siteOrigin, SITE_DESCRIPTION, jsonLd } from "@/lib/seo/config";
import Script from "next/script";
import "./globals.css";
import "./motion.css";
import "./interactions.css";
import "./discovery.css";
import "./refinements.css";
import "./playback.css";
import "./account.css";
import Providers from "./components/Providers";
import AppShell from "./components/AppShell";
import CookieConsent from "./components/CookieConsent";
import "./consent.css";
import "./profile-settings.css";
import "./flash.css";
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: {
    default: "ReeloGram — Watch and share videos",
    template: "%s — ReeloGram",
  },
  description: SITE_DESCRIPTION,
  applicationName: "ReeloGram",
  // Public pages explicitly opt in; new account routes are safe by default.
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      data-theme="light"
      suppressHydrationWarning
    >
      <head>
        <Script
          id="reelogram-theme"
          strategy="beforeInteractive"
        >{`try{document.documentElement.dataset.theme=localStorage.getItem('reelogram-theme')==='dark'?'dark':'light'}catch{}`}</Script>
      </head>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLd({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "ReeloGram",
              url: siteOrigin(),
            }),
          }}
        />
        <Providers>
          <AppShell>{children}</AppShell>
          <CookieConsent
            analyticsEnabled={process.env.VERCEL_ENV === "production"}
          />
        </Providers>
      </body>
    </html>
  );
}
