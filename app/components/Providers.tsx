"use client";

import { ImageKitProvider } from "imagekitio-next";
import { SessionProvider } from "next-auth/react";
import { FlashProvider } from "./FlashNotification";
import { serviceMessage } from "@/lib/http/service-message";

const urlEndpoint = process.env.NEXT_PUBLIC_REELOGRAM_URL_ENDPOINT;
const publicKey = process.env.NEXT_PUBLIC_REELOGRAM_PUBLIC_KEY;

export default function Providers({ children }: { children: React.ReactNode }) {
  const authenticator = async () => {
    const response = await fetch("/api/imagekit-auth", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? "Please sign in before uploading."
          : serviceMessage(
              response.status,
              "Upload authentication is unavailable.",
            ),
      );
    }
    const { signature, expire, token } = await response.json();
    return { signature, expire, token };
  };

  return (
    <SessionProvider>
      <FlashProvider>
        <ImageKitProvider
          urlEndpoint={urlEndpoint}
          publicKey={publicKey}
          authenticator={authenticator}
        >
          {children}
        </ImageKitProvider>
      </FlashProvider>
    </SessionProvider>
  );
}
