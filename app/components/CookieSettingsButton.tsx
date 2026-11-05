"use client";
import { CONSENT_EVENT } from "@/lib/analytics";
export default function CookieSettingsButton() {
  return <button className="cookie-settings-link" type="button" data-cookie-settings onClick={() => window.dispatchEvent(new Event(CONSENT_EVENT))}>Cookie settings</button>;
}
