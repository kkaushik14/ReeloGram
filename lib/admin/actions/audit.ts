import type { VerifiedAdminRequest } from "../signature.ts";

/** Operational attempt log, separate from durable transactional receipts.
 * Never include body, actor, reason, nonce, signature or raw error. */
export function auditActionAccess(
  identity: VerifiedAdminRequest,
  operation: "execute" | "receipt",
  status: number,
  write: (line: string) => void = console.info,
) {
  write(
    JSON.stringify({
      event: "admin.action-request",
      at: new Date().toISOString(),
      projectId: identity.projectId,
      environment: identity.environment,
      credentialId: identity.keyId,
      operation,
      status,
    }),
  );
}
