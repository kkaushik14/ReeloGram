"use client";

import {
  PASSWORD_POLICY,
  passwordCounts,
  passwordStrength,
} from "@/lib/auth/password-policy";
import styles from "./PasswordStrength.module.css";

export default function PasswordStrength({
  password,
  email,
  id = "password-strength",
}: {
  password: string;
  email?: string;
  id?: string;
}) {
  const counts = passwordCounts(password);
  const level = passwordStrength(password, email);
  const filled = password ? { Low: 1, Moderate: 2, High: 3 }[level] : 0;
  const requirements = [
    [counts.characters, PASSWORD_POLICY.minimumCharacters, "characters"],
    [counts.numbers, PASSWORD_POLICY.minimumNumbers, "numbers"],
    [
      counts.specialCharacters,
      PASSWORD_POLICY.minimumSpecialCharacters,
      "special",
    ],
  ] as const;

  return (
    <div className={styles.strength} id={id} data-level={level.toLowerCase()}>
      <div className={styles.heading}>
        <span>Password strength</span>
        <strong aria-live="polite" aria-atomic="true">
          {password ? level : "Not entered"}
        </strong>
      </div>
      <div className={styles.bars} aria-hidden="true">
        {[1, 2, 3].map((segment) => (
          <span key={segment} data-filled={segment <= filled} />
        ))}
      </div>
      <ul className={styles.requirements} aria-label="Password requirements">
        {requirements.map(([count, minimum, label]) => (
          <li key={label} data-met={count >= minimum}>
            <span aria-hidden="true">{count >= minimum ? "✓" : "○"}</span>{" "}
            {count}/{minimum} {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
