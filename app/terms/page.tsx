import Link from "next/link";
export default function TermsPage() {
  return (
    <article className="content policy-content">
      <Link className="back-link" href="/">
        ← Back to discover
      </Link>
      <h1>Terms of use</h1>
      <p className="policy-intro">
        A few ground rules for watching and sharing on ReeloGram. Updated 5
        November 2026.
      </p>
      <section>
        <h2>Your account</h2>
        <p>
          Use accurate account details and keep your password private. You are
          responsible for activity under your account. If you lose access, use
          the password recovery option on the sign-in screen.
        </p>
      </section>
      <section>
        <h2>Your videos stay yours</h2>
        <p>
          Only upload content you own or have permission to share. By posting a
          video, you allow ReeloGram and its storage providers to store, process
          and display it as part of the service. Your video, title, description,
          public name and profile picture are visible to other visitors.
        </p>
      </section>
      <section>
        <h2>Respect the people behind the screen</h2>
        <p>
          Do not post unlawful content, harassment, private information without
          permission, or material that violates someone else’s rights. Do not
          attempt to bypass account controls, disrupt the service or access
          another person’s account.
        </p>
      </section>
      <section>
        <h2>Credits and free resources</h2>
        <p>
          Featured videos retain their original creator and source credits. The
          linked source’s license governs how that material may be reused. A
          credit does not transfer ownership or imply a partnership with
          ReeloGram.
        </p>
      </section>
      <section>
        <h2>Changes and removal</h2>
        <p>
          You can edit or delete your own posted videos through Your videos.
          Deleted videos and their unshared linked files are removed from the
          service. Availability can be affected by maintenance, connection
          problems and storage or email provider outages.
        </p>
      </section>
      <section>
        <h2>Questions</h2>
        <p>
          See <Link href="/help">Help & answers</Link> for account and upload
          guidance, or{" "}
          <a
            href="https://github.com/kkaushik14/ReeloGram/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            report a service issue
          </a>
          . Our <Link href="/privacy">privacy policy</Link> explains the
          information used by the service.
        </p>
      </section>
    </article>
  );
}
