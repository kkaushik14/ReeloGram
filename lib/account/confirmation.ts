import { createHash, randomBytes } from "node:crypto";
export type ConfirmationKind = "email" | "parent";
export const CONFIRMATION_TTL = 24 * 60 * 60 * 1000;
export const validConfirmationToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const confirmationDigest = (kind: ConfirmationKind, token: string) =>
  createHash("sha256").update(`${kind}:${token}`).digest("hex");
export function createConfirmation(kind: ConfirmationKind) {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    stored: {
      digest: confirmationDigest(kind, token),
      expiresAt: new Date(Date.now() + CONFIRMATION_TTL),
    },
  };
}
