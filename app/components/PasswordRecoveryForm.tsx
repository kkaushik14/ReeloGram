"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { completeSignIn } from "@/lib/auth/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Aperture,
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";
import { passwordError, validResetToken } from "@/lib/auth/validation";
export default function PasswordRecoveryForm({
  reset = false,
}: {
  reset?: boolean;
}) {
  const router = useRouter();
  const tokenRead = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(!reset);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!reset || tokenRead.current) return;
    tokenRead.current = true;
    const value = new URLSearchParams(location.hash.slice(1)).get("token");
    setToken(validResetToken(value) ? value : null);
    setReady(true);
    if (value) history.replaceState(null, "", location.pathname);
  }, [reset]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    if (reset) {
      const problem = passwordError(password);
      if (problem) {
        setError(problem);
        return;
      }
      if (password !== confirmation) {
        setError("Your passwords don’t match.");
        return;
      }
    }
    setPending(true);
    try {
      const response = await fetch(
        reset ? "/api/auth/reset-password" : "/api/auth/forgot-password",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reset ? { token, password } : { email }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Please try again later.");
      if (reset) {
        const completed = await completeSignIn(data);
        if (completed) {
          router.push("/");
          router.refresh();
        } else
          setError("Your password is updated. Please sign in to continue.");
      }
      setDone(true);
      setPassword("");
      setConfirmation("");
      setToken(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Please try again later.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="auth-scene recovery-scene">
      <section className="auth-card" aria-labelledby="recovery-title">
        <Link href="/" className="auth-brand" aria-label="ReeloGram home">
          <Aperture size={27} />
          <span>
            <span className="brand-wordmark">ReeloGram</span><span className="brand-dot">.</span>
          </span>
        </Link>
        <h1 id="recovery-title">
          {done
            ? reset
              ? "A fresh start"
              : "Check your email"
            : reset
              ? "Set a new password"
              : "Forgot your password?"}
        </h1>
        {done ? (
          <>
            <div className="recovery-success">
              <Check size={24} />
            </div>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <p className="recovery-copy" role="status">
              {reset
                ? "Your password is updated and your previous sign-ins have been closed."
                : "If an account uses that email, a reset link will arrive shortly. Check your spam folder too. The link works once and expires in 20 minutes."}
            </p>
            <Link
              href={reset ? "/login?reset=1" : "/login"}
              className="button primary"
            >
              Back to sign in <ArrowRight size={18} />
            </Link>
            {!reset && (
              <button
                type="button"
                className="auth-back"
                onClick={() => {
                  setDone(false);
                  setError("");
                }}
              >
                Use a different email or try again
              </button>
            )}
          </>
        ) : !ready ? (
          <p role="status">Checking your link…</p>
        ) : reset && !token ? (
          <>
            <p className="error-text" role="alert">
              This reset link is invalid or has expired. Request a new link.
            </p>
            <Link href="/forgot-password" className="button primary">
              Request a reset link <ArrowRight size={18} />
            </Link>
          </>
        ) : (
          <>
            <p className="recovery-copy">
              {reset
                ? "Choose a password you haven’t used here before."
                : "Enter the email you use for ReeloGram. We’ll send you a link to choose a new password."}
            </p>
            <form onSubmit={submit} className="form-stack" aria-busy={pending}>
              {reset ? (
                <>
                  <label>
                    New password
                    <span className="password-wrap">
                      <input
                        aria-label="New password"
                        name="password"
                        type={visible ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        disabled={pending}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        disabled={pending}
                        aria-label={visible ? "Hide password" : "Show password"}
                        onClick={() => setVisible((value) => !value)}
                      >
                        {visible ? <EyeOff size={19} /> : <Eye size={19} />}
                      </button>
                    </span>
                    <small>At least 8 characters.</small>
                  </label>
                  <label>
                    Confirm password
                    <input
                      name="confirmation"
                      type={visible ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      disabled={pending}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </label>
                </>
              ) : (
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    placeholder="you@example.com"
                    disabled={pending}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
              )}
              {error && (
                <p className="error-text" role="alert">
                  {error}
                </p>
              )}
              <button className="button primary" disabled={pending}>
                {pending
                  ? "Please wait…"
                  : reset
                    ? "Save new password"
                    : "Send reset link"}
                {pending ? (
                  <span className="motion-spinner" aria-hidden="true" />
                ) : (
                  <ArrowRight size={18} />
                )}
              </button>
              {reset && error.includes("link") && (
                <Link className="forgot-link" href="/forgot-password">
                  Request a new reset link
                </Link>
              )}
            </form>
          </>
        )}
        {!done && (
          <Link href="/login" className="auth-back">
            <ArrowLeft size={15} />
            Back to sign in
          </Link>
        )}
      </section>
    </div>
  );
}
