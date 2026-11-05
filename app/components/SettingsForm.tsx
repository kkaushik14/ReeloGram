"use client";
import FlashMessage from "./FlashNotification";
import { useState } from "react";
import Link from "next/link";
import { Sun, Moon, Play, ShieldCheck, Check } from "lucide-react";
import AccountTabs from "./AccountTabs";
import CookieSettingsButton from "./CookieSettingsButton";
import { useBrowserPreferences } from "./useBrowserPreferences";
import { FormSkeleton } from "./LoadingState";
import type { BrowserPreferences, VideoQuality } from "@/lib/preferences";
export default function SettingsForm() {
  const { preferences, ready, save } = useBrowserPreferences();
  const [saved, setSaved] = useState("");
  function change(next: Partial<BrowserPreferences>) {
    const persisted = save({ ...preferences, ...next });
    setSaved(
      persisted
        ? "Your preferences are saved."
        : "Applied for now. Your browser couldn’t save these preferences for next time.",
    );
  }
  return (
    <div className="content account-content">
      <div className="page-heading">
        <div>
          <h1>Make it feel like you.</h1>
          <p>
            Your viewing preferences, in one place. Applies in this browser.
          </p>
        </div>
      </div>
      <AccountTabs current="settings" />
      {saved && <FlashMessage message={saved} variant="success" />}
      {!ready ? (
        <FormSkeleton />
      ) : (
        <>
          <section className="account-panel">
            <div className="account-section-heading">
              <Sun size={22} />
              <div>
                <h2>Appearance</h2>
                <p>Choose the look that feels right.</p>
              </div>
            </div>
            <div
              className="appearance-options"
              role="group"
              aria-label="Appearance"
            >
              <button
                type="button"
                aria-pressed={preferences.theme === "light"}
                onClick={() => change({ theme: "light" })}
              >
                <Sun size={22} />
                <span>Light</span>
                {preferences.theme === "light" && <Check size={18} />}
              </button>
              <button
                type="button"
                aria-pressed={preferences.theme === "dark"}
                onClick={() => change({ theme: "dark" })}
              >
                <Moon size={22} />
                <span>Dark</span>
                {preferences.theme === "dark" && <Check size={18} />}
              </button>
            </div>
          </section>
          <section className="account-panel">
            <div className="account-section-heading">
              <Play size={22} />
              <div>
                <h2>Watching videos</h2>
                <p>Balance picture quality and data use.</p>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <label htmlFor="setting-autoplay">
                  Play videos automatically
                </label>
                <p>
                  Start featured videos and Reels when they come into view. You
                  can always press play yourself.
                </p>
              </div>
              <input
                id="setting-autoplay"
                type="checkbox"
                role="switch"
                checked={preferences.autoplay}
                onChange={(event) => change({ autoplay: event.target.checked })}
              />
            </div>
            <div className="setting-row">
              <div>
                <label htmlFor="setting-quality">Video quality</label>
                <p>
                  High quality favours a sharper picture. Data saver uses
                  smaller files. Slow devices and browser data-saving settings
                  still apply.
                </p>
              </div>
              <select
                id="setting-quality"
                value={preferences.quality}
                onChange={(event) =>
                  change({ quality: event.target.value as VideoQuality })
                }
              >
                <option value="auto">Automatic</option>
                <option value="high">High quality</option>
                <option value="saver">Data saver</option>
              </select>
            </div>
          </section>
          <section className="account-panel">
            <div className="account-section-heading">
              <ShieldCheck size={22} />
              <div>
                <h2>Privacy and security</h2>
                <p>Keep control of your account and your choices.</p>
              </div>
            </div>
            <div className="settings-links">
              <Link href="/profile">View your profile</Link>
              <Link href="/forgot-password">Change your password</Link>
              <CookieSettingsButton />
              <Link href="/privacy">Privacy policy</Link>
              <Link href="/terms">Terms of use</Link>
            </div>
            <p className="setting-note">
              Security emails about password resets and account changes remain
              enabled to help keep your account safe.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
