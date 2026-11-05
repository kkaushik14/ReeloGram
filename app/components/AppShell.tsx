"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountSkeleton } from "./LoadingState";
import SiteFooter from "./SiteFooter";
import UploaderBadge from "./UploaderBadge";
import { useBrowserPreferences } from "./useBrowserPreferences";
import AccountLink from "./AccountLink";
import { signOut, useSession } from "next-auth/react";
import {
  Aperture,
  ArrowUpRight,
  Compass,
  Film,
  Plus,
  Moon,
  Sun,
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Clapperboard,
  UserRound,
  Settings,
} from "lucide-react";
export default function AppShell({ children }: { children: React.ReactNode }) {
  const menuButton = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const focusMenu = useRef(false);

  const path = usePathname();
  const { data: session, status } = useSession();
  const {
    preferences,
    save,
    ready: preferencesReady,
  } = useBrowserPreferences();
  const dark = preferences.theme === "dark";
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const frame = requestAnimationFrame(() => {
      if (focusMenu.current)
        navRef.current?.querySelector<HTMLAnchorElement>("nav a")?.focus();
    });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const controls = [
          menuButton.current,
          ...(navRef.current?.querySelectorAll<HTMLElement>(
            "a[href],button:not(:disabled)",
          ) ?? []),
        ].filter(
          (element): element is HTMLElement =>
            !!element && element.getClientRects().length > 0,
        );
        if (controls.length) {
          event.preventDefault();
          const index = controls.indexOf(document.activeElement as HTMLElement);
          controls[
            (index + (event.shiftKey ? -1 : 1) + controls.length) %
              controls.length
          ]?.focus();
        }
      }
      if (event.key === "Escape") {
        setMenu(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", escape);
    };
  }, [menu]);
  useEffect(() => {
    if (!menu || !mobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menu, mobile]);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("reelogram-sidebar") === "collapsed");
    } catch {}
  }, []);
  function toggleSidebar() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(
          "reelogram-sidebar",
          value ? "expanded" : "collapsed",
        );
      } catch {}
      return !value;
    });
  }
  useEffect(() => {
    const query = matchMedia("(max-width:700px)");
    const sync = () => {
      setMobile(query.matches);
      if (!query.matches) setMenu(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (preferencesReady)
      document.documentElement.dataset.theme = preferences.theme;
  }, [preferencesReady, preferences.theme]);
  function theme() {
    save({ ...preferences, theme: dark ? "light" : "dark" });
  }
  if (
    [
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/confirm-parent",
    ].includes(path)
  )
    return (
      <main id="main" tabIndex={-1} className="auth-only">
        {children}
      </main>
    );
  const nav = [
    { href: "/", label: "Discover", icon: Compass },
    { href: "/reels", label: "Reels", icon: Clapperboard },
    { href: "/my-videos", label: "Your videos", icon: Film },
    { href: "/upload", label: "Upload a video", icon: Plus },
    { href: "/profile", label: "Your profile", icon: UserRound },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  return (
    <div className={`app ${collapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside
        ref={navRef}
        id="navigation"
        inert={mobile && !menu}
        className={`sidebar ${menu ? "open" : ""}`}
      >
        <div className="sidebar-head">
          <Link
            href="/"
            aria-label="ReeloGram home"
            className="brand"
            onClick={() => setMenu(false)}
          >
            <span className="brand-icon">
              <Aperture size={25} />
            </span>
            <span className="brand-name">
              <span className="brand-wordmark">ReeloGram</span>
              <span className="brand-dot">.</span>
            </span>
          </Link>
          <button
            className="icon-button sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>
        <nav aria-label="Main navigation">
          {nav.map(({ href, label, icon: Icon }) => {
            const NavLink =
              href === "/profile" || href === "/settings" ? AccountLink : Link;
            return (
              <NavLink
                key={href}
                href={href}
                aria-label={label}
                className={`nav-item ${path === href ? "active" : ""}`}
                aria-current={path === href ? "page" : undefined}
                onClick={() => setMenu(false)}
              >
                <Icon size={20} />
                <span className="nav-text">{label}</span>
                <span className="nav-tooltip" aria-hidden="true">
                  {label}
                </span>
                {path === href && <span className="nav-mark" />}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-note">
          <span className="small-icon">
            <Film size={20} />
          </span>
          <h3>Something worth sharing?</h3>
          <Link href="/upload" onClick={() => setMenu(false)}>
            Share a video <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="sidebar-bottom">
          <div className="mobile-account" aria-label="Your account">
            {status === "loading" ? (
              <AccountSkeleton />
            ) : session ? (
              <>
                <AccountLink
                  href="/profile"
                  aria-label="Your profile"
                  onClick={() => setMenu(false)}
                >
                  <UploaderBadge
                    uploader={{
                      id: session.user.id,
                      name:
                        session.user.name ||
                        session.user.email?.split("@")[0] ||
                        "Your account",
                      image: session.user.image || undefined,
                    }}
                  />
                </AccountLink>
                <button
                  className="mobile-sign-out"
                  onClick={() => signOut({ callbackUrl: "/" })}
                >
                  <LogOut size={18} />
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setMenu(false)}>
                  Sign in
                </Link>
                <Link href="/register" onClick={() => setMenu(false)}>
                  Join ReeloGram <ArrowUpRight size={15} />
                </Link>
              </>
            )}
          </div>
          <button
            className="nav-item"
            aria-label={dark ? "Light appearance" : "Dark appearance"}
            onClick={theme}
          >
            {dark ? <Sun size={20} /> : <Moon size={20} />}{" "}
            <span className="nav-text">
              {dark ? "Light appearance" : "Dark appearance"}
            </span>
            <span className="nav-tooltip" aria-hidden="true">
              {dark ? "Light appearance" : "Dark appearance"}
            </span>
          </button>
          <div className="sidebar-foot">
            © {new Date().getFullYear()}{" "}
            <strong className="brand-wordmark">ReeloGram</strong>
          </div>
        </div>
      </aside>
      {menu && mobile && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation backdrop"
          tabIndex={-1}
          onClick={() => {
            setMenu(false);
            menuButton.current?.focus({ preventScroll: true });
          }}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <Link
            href="/"
            className="mobile-brand"
            aria-label="ReeloGram home"
            onClick={() => setMenu(false)}
          >
            <Aperture size={23} />
            <strong className="brand-wordmark">ReeloGram</strong>
          </Link>
          <button
            ref={menuButton}
            className="icon-button mobile-menu"
            aria-controls="navigation"
            aria-expanded={menu}
            aria-label={menu ? "Close navigation" : "Open navigation"}
            onClick={(event) => {
              focusMenu.current = event.detail === 0;
              setMenu(!menu);
            }}
          >
            {menu ? <X /> : <Menu />}
          </button>
          <div className="account-actions">
            {status === "loading" ? (
              <AccountSkeleton />
            ) : session ? (
              <>
                <AccountLink href="/profile" aria-label="Your profile">
                  <UploaderBadge
                    uploader={{
                      id: session.user.id,
                      name:
                        session.user.name ||
                        session.user.email?.split("@")[0] ||
                        "Your account",
                      image: session.user.image || undefined,
                    }}
                  />
                </AccountLink>
                <button
                  className="icon-button"
                  aria-label="Sign out"
                  onClick={() => signOut({ callbackUrl: "/" })}
                >
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="text-button">
                  Sign in
                </Link>
                <Link href="/register" className="button secondary small">
                  Join ReeloGram <ArrowUpRight size={15} />
                </Link>
              </>
            )}
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
