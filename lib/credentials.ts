import { parseEmail } from "./auth/validation.ts";
export function parseCredentials(
  value: unknown,
): { email: string; password: string } | null {
  if (!value || typeof value !== "object") return null;
  const { email, password } = value as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") return null;
  const normalizedEmail = parseEmail(email);
  if (!normalizedEmail) return null;
  if (!password || new TextEncoder().encode(password).length > 72) return null;
  return { email: normalizedEmail, password };
}
