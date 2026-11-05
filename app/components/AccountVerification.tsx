"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { MailCheck, ShieldCheck } from "lucide-react";
import type { AccountProfile } from "@/lib/account/profile";
import ParentFields from "./ParentFields";
import DateOfBirthCorrection from "./DateOfBirthCorrection";
import { useFlash } from "./FlashNotification";
export default function AccountVerification({
  profile,
  refresh,
}: {
  profile: AccountProfile;
  refresh: () => Promise<void>;
}) {
  const flash = useFlash(),
    { update } = useSession();
  const [email, setEmail] = useState(profile.parent.email || "");
  const [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setEmail(profile.parent.email || "");
  }, [profile.parent.email]);
  async function send(kind: "email" | "parent") {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/account/verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          ...(kind === "parent"
            ? { parentEmail: email, parentManaged: accepted }
            : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Please try again.");
      flash(data.message, "success");
      await refresh();
      await update();
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
    <section
      className="account-panel account-verification"
      aria-label="Account confirmation"
    >
      <div className="account-section-heading">
        <MailCheck size={22} />
        <div>
          <h2>
            {profile.emailVerified ? "Email confirmed" : "Confirm your email"}
          </h2>
          <p>
            {profile.emailVerified
              ? "Your email address has been confirmed."
              : "Confirm ownership of your email before uploading or publishing."}
          </p>
        </div>
      </div>
      {(!profile.emailVerified ||
        (profile.parent.required &&
          !profile.parent.ownerConfirmed &&
          !!profile.parent.email)) && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void send("email")}
        >
          {busy
            ? "Sending…"
            : profile.emailVerified
              ? "Approve parent address from your email"
              : "Send confirmation email"}
        </button>
      )}
      {profile.parent.required && (
        <div className="parent-management">
          {profile.parent.confirmed ? (
            <>
              <span className="parent-badge">
                <ShieldCheck size={18} />
                Handled by parent
              </span>
              <p>
                Account notifications and password-reset links are also sent to{" "}
                <strong>{profile.parent.email}</strong>.
              </p>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send("parent");
              }}
            >
              <h2>Parent confirmation pending</h2>
              <p>
                Both your email and the parent’s email must confirm this address
                before management starts.
              </p>
              <ParentFields
                email={email}
                accepted={accepted}
                onEmail={setEmail}
                onAccepted={setAccepted}
                disabled={busy}
              />
              <button className="button secondary" disabled={busy}>
                {busy
                  ? "Sending…"
                  : profile.parent.email
                    ? "Send a new parent confirmation"
                    : "Ask parent to confirm"}
              </button>
            </form>
          )}
        </div>
      )}
      {(!profile.emailVerified ||
        (profile.parent.required && !profile.parent.confirmed)) && (
        <button
          className="text-button verification-refresh"
          disabled={busy}
          onClick={async () => {
            await refresh();
            await update();
          }}
        >
          Refresh confirmation status
        </button>
      )}
      {profile.parent.required &&
        !profile.parent.confirmed &&
        profile.dateOfBirth && (
          <DateOfBirthCorrection
            value={profile.dateOfBirth}
            refresh={refresh}
          />
        )}
    </section>
  );
}
