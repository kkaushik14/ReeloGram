import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  distDir: process.env.E2E_DIST_DIR || ".next",
  typescript: {
    tsconfigPath: process.env.E2E_DIST_DIR ? ".e2e.tsconfig.json" : "tsconfig.json",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ik.imagekit.io",
        port: "",
      },
    ],
  },
};

export default nextConfig;
