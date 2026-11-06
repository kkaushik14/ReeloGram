"use client";
import { useLayoutEffect } from "react";
import { lockPageScroll } from "@/lib/browser/scroll-lock";

export function usePageScrollLock(active: boolean) {
  useLayoutEffect(() => {
    if (active) return lockPageScroll(document);
  }, [active]);
}
