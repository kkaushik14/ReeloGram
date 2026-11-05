import type { Metadata } from "next";
import "./globals.css";
import "./motion.css";
import "./interactions.css";
import Providers from "./components/Providers";
import AppShell from "./components/AppShell";
export const metadata: Metadata = { title: "ReeloGram — Stories in motion", description: "Discover a fresh perspective. Watch and share videos on ReeloGram." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="light" suppressHydrationWarning><body><Providers><AppShell>{children}</AppShell></Providers></body></html>;
}
