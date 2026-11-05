"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Aperture, ShieldCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { validResetToken as validConfirmationToken } from "@/lib/auth/validation";
import { useFlash } from "./FlashNotification";
export default function EmailConfirmationForm({
  parent = false,
}: {
  parent?: boolean;
}) {
  const [token, setToken] = useState<string | null>(null),
    [ready, setReady] = useState(false);
  const [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [managementActive, setManagementActive] = useState(false);
  const first = useRef(true),
    flash = useFlash(),
    { update } = useSession();
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    const value = new URLSearchParams(location.hash.slice(1)).get("token");
    setToken(validConfirmationToken(value) ? value : null);
    setReady(true);
    if (value) history.replaceState(null, "", location.pathname);
  }, []);
  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          kind: parent ? "parent" : "email",
          accepted,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Please try again.");
      setManagementActive(data.managementActive === true);
      setDone(true);
      setToken(null);
      flash(data.message, "success");
      await update().catch(() => null);
    } catch (error) {
      flash(
        error instanceof Error ? error.message : "Please try again.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card confirmation-card">
      <Link href="/" className="auth-brand">
        <Aperture size={27} />
        <strong className="brand-wordmark">ReeloGram</strong>
      </Link>
      <h1>
        {done
          ? parent
            ? managementActive
              ? "Parent management confirmed."
              : "Parent email confirmed."
            : "Email confirmed."
          : parent
            ? "Manage this account."
            : "Confirm your email."}
      </h1>
      {done ? (
        <>
          <ShieldCheck size={32} />
          <p>
            You can return to Profile to see the updated confirmation status.
          </p>
          <Link className="button primary" href="/profile">
            Open Profile
          </Link>
        </>
      ) : !ready ? (
        <p>Checking your link…</p>
      ) : !token ? (
        <>
          <p>
            This link is missing or no longer available. Request a new
            confirmation from Profile.
          </p>
          <Link className="button primary" href="/profile">
            Open Profile
          </Link>
        </>
      ) : (
        <form onSubmit={confirm} className="form-stack">
          <p>
            {parent
              ? "Confirm only if you are this user’s parent or guardian. You will receive account notifications and password-reset links that allow access to the account. Public posts can include the user’s name, photo and video."
              : "Confirm that this email belongs to you before uploading or publishing."}
          </p>
          {parent && (
            <label className="parent-check">
              <input
                type="checkbox"
                required
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                disabled={busy}
              />
              <span>
                I am the parent or guardian and agree to manage this account. I
                have read the <Link href="/privacy">Privacy policy</Link> and{" "}
                <Link href="/terms">Terms of use</Link>.
              </span>
            </label>
          )}
          <button className="button primary" disabled={busy}>
            {busy
              ? "Confirming…"
              : parent
                ? "Confirm parent management"
                : "Confirm email"}
          </button>
        </form>
      )}
    </section>
  );
}
