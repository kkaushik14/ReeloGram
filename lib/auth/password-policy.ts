/** Shared by password creation/reset and their forms, never by existing-user login. */
export const PASSWORD_POLICY = {
  minimumCharacters: 15,
  maximumBytes: 72, // bcrypt must never silently truncate the supplied password.
  help: "Use at least 15 characters. Several unrelated words work well. Avoid common passwords, repeating patterns and your email address.",
} as const;

const common = new Set([
  "password",
  "passwords",
  "passphrase",
  "letmein",
  "iloveyou",
  "welcome",
  "admin",
  "administrator",
  "changeme",
  "qwerty",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "reelogram",
  "thisisapassword",
  "thisismypassword",
  "mysecretpassword",
  "correcthorsebatterystaple",
]);

export function passwordError(
  value: unknown,
  email?: string | null,
): string | null {
  if (typeof value !== "string") return "Enter a password.";
  // Bound work before Unicode iteration or normalization, including direct API requests.
  if (
    value.length > PASSWORD_POLICY.maximumBytes ||
    new TextEncoder().encode(value).length > PASSWORD_POLICY.maximumBytes
  )
    return "This password is too long. Use up to 72 English letters, or fewer characters for other languages and emoji.";
  if ([...value].length < PASSWORD_POLICY.minimumCharacters)
    return `Use at least ${PASSWORD_POLICY.minimumCharacters} characters for your password.`;
  const normalized = value.normalize("NFKC").toLowerCase();
  const compact = normalized.replace(/[^\p{L}\p{N}]/gu, "");
  if (!compact || /^(\d+)$/.test(compact) || /^(.{1,8})\1+$/u.test(compact))
    return "Avoid a password made only of numbers, spaces or repeating patterns.";
  const stem = compact.replace(/[0-9]+/g, "");
  if (
    common.has(compact) ||
    common.has(stem) ||
    /^(?:password|qwerty|welcome|admin|reelogram)+$/.test(stem)
  )
    return "This password is too easy to guess. Choose several unrelated words instead.";
  const sequences = [
    "abcdefghijklmnopqrstuvwxyz",
    "qwertyuiopasdfghjklzxcvbnm",
  ];
  if (
    sequences.some(
      (sequence) =>
        sequence.includes(compact) ||
        [...sequence].reverse().join("").includes(compact),
    )
  )
    return "Avoid alphabet or keyboard sequences in your password.";
  const identity = email?.trim().normalize("NFKC").toLowerCase();
  const local = identity?.split("@")[0].replace(/[^\p{L}\p{N}]/gu, "");
  if (
    identity &&
    (normalized === identity ||
      (local && local.length >= 4 && (compact === local || stem === local)))
  )
    return "Choose a password different from your email address.";
  return null;
}
