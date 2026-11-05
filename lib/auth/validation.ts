export function parseEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254) return null;
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (
    !local ||
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
  )
    return null;
  if (
    !domain.includes(".") ||
    !domain
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    return null;
  return email;
}
export function passwordError(value: unknown) {
  if (typeof value !== "string" || value.length < 8)
    return "Use at least 8 characters for your password.";
  if (new TextEncoder().encode(value).length > 72)
    return "Use a password of no more than 72 bytes.";
  if (!value.trim()) return "Choose a password that contains more than spaces.";
  return null;
}
export function parseProfile(value: unknown, now = new Date()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { name, dateOfBirth } = value as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 80 ||
    /[\x00-\x1f\x7f]/.test(name)
  )
    return null;
  if (
    typeof dateOfBirth !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
  )
    return null;
  const date = new Date(dateOfBirth + "T00:00:00.000Z");
  const today = now.toISOString().slice(0, 10);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== dateOfBirth ||
    dateOfBirth > today ||
    now.getUTCFullYear() - date.getUTCFullYear() > 120
  )
    return null;
  return { name: name.trim().replace(/\s+/g, " "), dateOfBirth: date };
}
export const RESET_TOKEN_TTL_MS = 20 * 60 * 1000;
export const validResetToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
