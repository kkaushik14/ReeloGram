import { createHash, randomBytes } from "node:crypto";
/** A one-time exchange into NextAuth; never put this token in a URL or browser storage. */
export function createSignInGrant() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    stored: {
      digest: signInGrantDigest(token),
      expiresAt: new Date(Date.now() + 60000),
    },
  };
}
export function signInGrantDigest(token: string) {
  return createHash("sha256")
    .update("sign-in:" + token)
    .digest("hex");
}
