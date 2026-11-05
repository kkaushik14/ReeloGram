import Link from "next/link";
import { Aperture, ArrowUpRight } from "lucide-react";
import CookieSettingsButton from "./CookieSettingsButton";
import AccountLink from "./AccountLink";
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div className="footer-intro">
          <Link
            prefetch={false}
            className="footer-brand"
            href="/"
            aria-label="ReeloGram home"
          >
            <Aperture size={28} />
            <strong className="brand-wordmark">ReeloGram.</strong>
          </Link>
          <p>
            Good moments deserve
            <br />a place to be seen.
          </p>
          <Link prefetch={false} className="footer-cta" href="/upload">
            Share your perspective <ArrowUpRight size={19} />
          </Link>
        </div>
        <nav aria-label="Footer explore">
          <h2>Explore</h2>
          <Link prefetch={false} href="/">
            Browse videos
          </Link>
          <Link prefetch={false} href="/reels">
            Watch Reels
          </Link>
          <Link prefetch={false} href="/my-videos">
            Your videos
          </Link>
          <Link prefetch={false} href="/upload">
            Upload a video
          </Link>
        </nav>
        <nav aria-label="Footer support">
          <h2>Make yourself at home</h2>
          <Link prefetch={false} href="/help">
            Help & answers
          </Link>
          <AccountLink href="/profile">Your profile</AccountLink>
          <AccountLink href="/settings">Settings</AccountLink>
          <a
            href="https://github.com/kkaushik14/ReeloGram/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            Report an issue <ArrowUpRight size={14} />
          </a>
        </nav>
        <nav aria-label="Footer policies">
          <h2>The details</h2>
          <Link prefetch={false} href="/terms">
            Terms of use
          </Link>
          <Link prefetch={false} href="/privacy">
            Privacy policy
          </Link>
          <CookieSettingsButton />
          <a
            href="https://github.com/kkaushik14/ReeloGram"
            target="_blank"
            rel="noopener noreferrer"
          >
            Find us on GitHub <ArrowUpRight size={14} />
          </a>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>
          © {new Date().getFullYear()}{" "}
          <strong className="brand-wordmark">ReeloGram</strong>
        </span>
        <span>Made for a fresh perspective.</span>
        <a href="#main">Back to top ↑</a>
      </div>
    </footer>
  );
}
