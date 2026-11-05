"use client";
export default function ParentFields({
  email,
  accepted,
  onEmail,
  onAccepted,
  disabled = false,
}: {
  email: string;
  accepted: boolean;
  onEmail: (value: string) => void;
  onAccepted: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="parent-fields">
      <legend>Parent or guardian</legend>
      <p>A parent or guardian needs to manage accounts for users under 13.</p>
      <label>
        Parent’s email
        <input
          name="parentEmail"
          type="email"
          autoComplete="off"
          required
          maxLength={254}
          value={email}
          disabled={disabled}
          onChange={(event) => onEmail(event.target.value)}
        />
      </label>
      <label className="parent-check">
        <input
          name="parentManaged"
          type="checkbox"
          required
          checked={accepted}
          disabled={disabled}
          onChange={(event) => onAccepted(event.target.checked)}
        />
        <span>
          A parent or guardian will manage this account and receive account
          emails, including password-reset links.
        </span>
      </label>
      <small>
        We’ll ask the parent to confirm their email before this account can
        publish.
      </small>
    </fieldset>
  );
}
