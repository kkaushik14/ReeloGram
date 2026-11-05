import Link from "next/link";
import CookieSettingsButton from "@/app/components/CookieSettingsButton";
export default function PrivacyPage() {
  return (
    <article className="content policy-content">
      <Link className="back-link" href="/">
        ← Back to discover
      </Link>
      <h1>Privacy policy</h1>
      <p className="policy-intro">
        What ReeloGram stores, what other people can see, and how that
        information is used. Updated 5 November 2026.
      </p>
      <section>
        <h2>Account information</h2>
        <p>
          We store your email address, name, date of birth and a one-way
          password hash to create and protect your account. Your date of birth
          and email address are not included in the public video feed. Existing
          accounts without a separate name may display the part of their email
          before the @ symbol as a public handle.
        </p>
      </section>
      <section>
        <h2>What you share publicly</h2>
        <p>
          Posted videos, cover images, titles, descriptions, your public name
          and an available profile picture can be viewed by other visitors. If
          there is no profile picture, your initials are displayed. You control
          your own videos through Your videos.
        </p>
        <p>
          You can set or remove your profile photo from your protected Profile
          page. Uploaded profile photos are checked and resized, and embedded
          image metadata is removed before storage. If your name or date of
          birth is missing, you can add it once in Profile. Saved details and
          your sign-in email are read-only.
        </p>
      </section>
      <section>
        <h2>Email and parent-managed accounts</h2>
        <p>
          Email addresses are checked for formatting, known temporary services
          and mail delivery records. A confirmation link verifies control of the
          inbox. Confirmation links expire after 24 hours and work once. Email
          domains are checked through DNS; addresses are not sent to an external
          email-verification service.
        </p>
        <p>
          For users under 13, we request a parent or guardian’s email and an
          explicit management choice. Both the account’s own inbox and the
          parent’s inbox must confirm the named address before parent management
          starts. The confirmed parent receives account notifications and
          password-reset links, which allow access to the account. Parent email
          addresses and birth dates are private. Analytics remains off for
          accounts known to belong to users under 13.
        </p>
        <p>
          Email confirmation verifies access to an inbox. It does not
          independently prove a person’s age or legal relationship to another
          person.
        </p>
      </section>
      <section>
        <h2>Storage and delivery</h2>
        <p>
          MongoDB stores account and video records. ImageKit stores and delivers
          video files and images. Transactional email is delivered through the
          configured email provider, using SMTP in the current configuration.
          These providers process the information needed to perform those
          services.
        </p>
      </section>
      <section>
        <h2>Account messages and security</h2>
        <p>
          We send messages related to your account, password changes and posted
          videos. Password reset links expire after 20 minutes and work once.
          Reset tokens are stored as hashes; unused tokens are replaced by a
          later request. Temporary security counters help limit repeated
          requests. Queued account messages expire after seven days and their
          message content is removed after successful sending.
        </p>
      </section>
      <section>
        <h2>Cookies and preferences</h2>
        <p>
          Sign-in uses authentication cookies. Your browser also stores
          appearance and sidebar preferences. The player can use connection and
          device information exposed by your browser to choose a suitable video
          quality. Your cookie choice is stored in this browser for up to 180
          days.
        </p>
        <p>
          Appearance, autoplay and picture-quality preferences are saved in this
          browser. You can manage them in Settings. Security limits use
          temporary hashed account and network counters to reduce automated
          abuse.
        </p>
        <p>
          Optional Google Analytics loads only after you allow analytics
          cookies. It helps us understand page visits and site usage. Account
          pages, form details, search queries and password-reset links are
          excluded from our page-view tracking. Google receives usage and device
          information when analytics is enabled. Advertising features are
          disabled. Choosing essential cookies keeps analytics off and leaves
          sign-in, uploads and playback available.
        </p>
        <p>
          You can withdraw or change your choice at any time using{" "}
          <CookieSettingsButton />. Turning analytics off stops future tracking
          and removes this site’s Google Analytics cookies. It does not erase
          data already received by Google.
        </p>
      </section>
      <section>
        <h2>Managing your information</h2>
        <p>
          You can remove your posted videos and their unshared linked files from
          Your videos. For other account or privacy requests, contact the
          project maintainer through the{" "}
          <a
            href="https://github.com/kkaushik14/ReeloGram"
            target="_blank"
            rel="noopener noreferrer"
          >
            project’s GitHub page
          </a>{" "}
          to arrange a private conversation. Public issue reports are for
          service problems; account information should be handled privately.
        </p>
      </section>
    </article>
  );
}
