import "@/lib/auth/environment";
import type { Metadata } from "next";
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
export const metadata: Metadata = { title: "ReeloGram — Stories in motion", description: "Discover a fresh perspective. Watch and share videos on ReeloGram." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth" data-theme="light" suppressHydrationWarning><body><Providers><AppShell>{children}</AppShell><CookieConsent analyticsEnabled={process.env.VERCEL_ENV === "production"} /></Providers></body></html>;
}
