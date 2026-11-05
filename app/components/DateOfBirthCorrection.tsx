"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useFlash } from "./FlashNotification";

export default function DateOfBirthCorrection({
  value,
  refresh,
}: {
  value: string;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(value);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const flash = useFlash();
  const { update } = useSession();
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  return (
    <div className="birthday-correction">
      <button
        ref={trigger}
        type="button"
        className="text-button"
        aria-expanded={editing}
        disabled={busy}
        onClick={() => {
          setDate(value);
          setEditing(!editing);
        }}
      >
        Change date of birth
      </button>
      {editing && (
        <form
          className="form-stack"
          aria-label="Change date of birth"
          aria-busy={busy}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            try {
              const response = await fetch("/api/account/date-of-birth", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  dateOfBirth: date,
                  previousDateOfBirth: value,
                }),
              });
              const data = await response.json();
              if (!response.ok) {
                if (response.status === 409) await refresh();
                throw Error(
                  data.error || "Your date of birth couldn’t be updated.",
                );
              }
              setEditing(false);
              await refresh();
              await update();
              flash(data.message, "success");
              trigger.current?.focus();
            } catch (error) {
              flash(
                error instanceof Error ? error.message : "Please try again.",
                "error",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Date of birth
            <input
              ref={input}
              type="date"
              autoComplete="bday"
              required
              disabled={busy}
              max={new Date().toISOString().slice(0, 10)}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              onInput={(event) => setDate(event.currentTarget.value)}
            />
          </label>
          <div className="birthday-correction-actions">
            <button className="button secondary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save date of birth"}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                trigger.current?.focus();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
