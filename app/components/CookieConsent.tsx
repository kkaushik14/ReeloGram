"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cookie } from "lucide-react";
import { useSession } from "next-auth/react";
import {
  ANALYTICS_ID,
  CONSENT_EVENT,
  CONSENT_KEY,
  CONSENT_LIFETIME_MS,
  analyticsPage,
  readCookieChoice,
  type CookieChoice,
} from "@/lib/analytics";

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  "ga-disable-G-B6PDWD34WF"?: boolean;
};

function removeAnalyticsCookies() {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0].trim();
    if (!/^_ga(?:_|$)/.test(name)) continue;
    for (const domain of ["", location.hostname, "." + location.hostname])
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? "; Domain=" + domain : ""}${location.protocol === "https:" ? "; Secure" : ""}`;
  }
}

export default function CookieConsent({
  analyticsEnabled,
}: {
  analyticsEnabled: boolean;
}) {
  const { data: session, status } = useSession();
  const under13 = session?.user.parentRequired === true;
  const pathname = usePathname();
  const [choice, setChoice] = useState<CookieChoice | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const configured = useRef(false);
  const lastPage = useRef("");
  const title = useRef<HTMLHeadingElement>(null);
  const managing = useRef(false);

  useEffect(() => {
    const sync = () => {
      let saved: CookieChoice | null = null;
      try {
        saved = readCookieChoice(localStorage.getItem(CONSENT_KEY));
      } catch {}
      setChoice(saved);
      setOpen(!saved);
      setReady(true);
    };
    const manage = () => {
      managing.current = true;
      setOpen(true);
    };
    const storage = (event: StorageEvent) => {
      if (!event.key || event.key === CONSENT_KEY) sync();
    };
    sync();
    window.addEventListener("storage", storage);
    window.addEventListener(CONSENT_EVENT, manage);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener(CONSENT_EVENT, manage);
    };
  }, []);
  useEffect(() => {
    if (open && managing.current) title.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!choice) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = choice.updatedAt + CONSENT_LIFETIME_MS - Date.now();
      if (remaining <= 0) {
        setChoice(null);
        setOpen(true);
        return;
      }
      timer = setTimeout(check, Math.min(remaining, 86400000));
    };
    check();
    return () => clearTimeout(timer);
  }, [choice]);

  const allowed =
    ready &&
    status !== "loading" &&
    !under13 &&
    !!choice?.analytics &&
    analyticsEnabled &&
    !!analyticsPage(pathname, "https://reelogram.duckdns.org");
  useEffect(() => {
    if (!ready) return;
    const target = window as AnalyticsWindow;
    target["ga-disable-G-B6PDWD34WF"] = !allowed;
    if (!allowed) {
      lastPage.current = "";
      if (!choice?.analytics || under13) removeAnalyticsCookies();
      return;
    }
    const page = analyticsPage(pathname, location.origin);
    if (!page) return;
    target.dataLayer ||= [];
    // Match Google's documented gtag command queue, which uses an Arguments object.
    target.gtag ||= function () {
      // eslint-disable-next-line prefer-rest-params
      target.dataLayer!.push(arguments);
    };
    // Override location/referrer globally before loading the tag. Account tokens,
    // search terms and form data must never enter automatic or manual page events.
    target.gtag("set", { ...page, page_referrer: location.origin + "/" });
    if (!configured.current) {
      target.gtag("consent", "default", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
      target.gtag("consent", "update", {
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
      target.gtag("js", new Date());
      target.gtag("config", ANALYTICS_ID, {
        ...page,
        page_referrer: location.origin + "/",
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        cookie_flags: "SameSite=Lax;Secure",
        cookie_expires: 180 * 86400,
      });
      configured.current = true;
    }
    if (lastPage.current !== pathname) {
      target.gtag("event", "page_view", {
        ...page,
        page_referrer: location.origin + "/",
        send_to: ANALYTICS_ID,
      });
      lastPage.current = pathname;
    }
    // Match the supplied Google installation guidance without contacting Google
    // before consent. A stable ID prevents duplicate loaders during SPA navigation.
    if (!document.getElementById("reelogram-google-analytics")) {
      const script = document.createElement("script");
      script.id = "reelogram-google-analytics";
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_ID}`;
      script.referrerPolicy = "origin";
      script.dataset.analyticsReady = "loading";
      script.onload = () => {
        script.dataset.analyticsReady = "ready";
      };
      script.onerror = () => {
        script.dataset.analyticsReady = "unavailable";
      };
      document.head.appendChild(script);
    }
  }, [allowed, ready, pathname, choice, under13]);

  function choose(analytics: boolean) {
    const next: CookieChoice = { version: 1, analytics, updatedAt: Date.now() };
    if (!analytics) {
      (window as AnalyticsWindow)["ga-disable-G-B6PDWD34WF"] = true;
      removeAnalyticsCookies();
    }
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(next));
    } catch {}
    setChoice(next);
    setOpen(false);
    if (managing.current)
      document
        .querySelector<HTMLButtonElement>("[data-cookie-settings]")
        ?.focus();
    managing.current = false;
  }

  return (
    <>
      {ready && open && (
        <section
          className="cookie-consent"
          role="region"
          aria-labelledby="cookie-consent-title"
        >
          <div className="cookie-consent-icon" aria-hidden="true">
            <Cookie size={23} />
          </div>
          <div className="cookie-consent-content">
            <h2 id="cookie-consent-title" ref={title} tabIndex={-1}>
              A little choice about cookies.
            </h2>
            <p>
              Essential cookies keep your account working. With your permission,
              Google Analytics helps us understand how the site is used. You can
              change your choice anytime.
            </p>
            <Link href="/privacy">Read our privacy policy</Link>
            <div className="cookie-consent-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => choose(false)}
              >
                Essential only
              </button>
              {!under13 && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => choose(true)}
                >
                  Allow analytics
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
