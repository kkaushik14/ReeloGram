"use client";
import { useEffect, useState } from "react";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  PREFERENCES_EVENT,
  parsePreferences,
  type BrowserPreferences,
} from "@/lib/preferences";
let memory = DEFAULT_PREFERENCES;
let storageUnavailable = false;
export function useBrowserPreferences() {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sync = () => {
      let next = memory;
      try {
        if (!storageUnavailable)
          next = parsePreferences(
            localStorage.getItem(PREFERENCES_KEY),
            localStorage.getItem("reelogram-theme"),
          );
      } catch {
        storageUnavailable = true;
      }
      memory = next;
      setPreferences(next);
      setReady(true);
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(PREFERENCES_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(PREFERENCES_EVENT, sync);
    };
  }, []);
  function save(next: BrowserPreferences) {
    memory = next;
    setPreferences(next);
    document.documentElement.dataset.theme = next.theme;
    try {
      localStorage.setItem(
        PREFERENCES_KEY,
        JSON.stringify({ quality: next.quality, autoplay: next.autoplay }),
      );
      localStorage.setItem("reelogram-theme", next.theme);
      storageUnavailable = false;
    } catch {
      storageUnavailable = true;
    }
    window.dispatchEvent(new Event(PREFERENCES_EVENT));
    return !storageUnavailable;
  }
  return { preferences, ready, save };
}
