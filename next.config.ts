import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [{source:"/:path*",headers:[
      {key:"X-Content-Type-Options",value:"nosniff"},
      {key:"X-Frame-Options",value:"DENY"},
      {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},
      {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"},
      {key:"Content-Security-Policy",value:"frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"},
    ]}];
  },
  // Only these two public ImageKit values may enter browser bundles.
  env: {
    NEXT_PUBLIC_REELOGRAM_PUBLIC_KEY:
      process.env.REELOGRAM_NEXT_PUBLIC_PUBLIC_KEY,
    NEXT_PUBLIC_REELOGRAM_URL_ENDPOINT:
      process.env.REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT,
  },
  distDir: process.env.REELOGRAM_E2E_DIST_DIR || ".next",
  typescript: {
    tsconfigPath: process.env.REELOGRAM_E2E_DIST_DIR
      ? ".e2e.tsconfig.json"
      : "tsconfig.json",
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
