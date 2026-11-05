import Link from "next/link";
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
          quality.
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
