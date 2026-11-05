import Link from "next/link";
export default function HelpPage() {
  return (
    <article className="content policy-content">
      <Link className="back-link" href="/">
        ← Back to discover
      </Link>
      <h1>A little help along the way.</h1>
      <p className="policy-intro">
        Everything you need to start watching and sharing.
      </p>
      <section>
        <h2>How do I create an account?</h2>
        <p>
          Start with your email on the <Link href="/login">sign-in page</Link>.
          If you already have an account, enter your password. If you’re new,
          add your name and date of birth, then create a password. Your date of
          birth stays private.
        </p>
      </section>
      <section>
        <h2>I forgot my password.</h2>
        <p>
          Choose <Link href="/forgot-password">Forgot password</Link> and enter
          your email. A reset link is sent if an account uses that address.
          Check your spam folder. Each link works once for 20 minutes; asking
          again replaces the previous link.
        </p>
      </section>
      <section>
        <h2>What can I upload?</h2>
        <p>
          Upload an MP4 or WebM video up to 100 MB, plus a JPG, PNG or WebP
          cover up to 5 MB. Give it a title and description. Share only content
          you have permission to post. Successful uploads appear in Browse and
          Reels with your public name and picture or initials.
        </p>
      </section>
      <section>
        <h2>How does video quality work?</h2>
        <p>
          The player adjusts quality to the connection, device and screen.
          Faster connections and capable devices can use higher quality when the
          source supports it. Only the selected Reel plays. Pause, sound and
          navigation controls remain available when you expand the Reel section.
        </p>
      </section>
      <section>
        <h2>Can I change or remove a video?</h2>
        <p>
          Open <Link href="/my-videos">Your videos</Link> to edit its title or
          description, or delete it. Only the person who uploaded a video can
          change it.
        </p>
      </section>
      <section>
        <h2>Something isn’t working.</h2>
        <p>
          <a
            href="https://github.com/kkaushik14/ReeloGram/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            Report an issue on GitHub
          </a>{" "}
          with the page, browser and steps that led to the problem.
        </p>
      </section>
    </article>
  );
}
