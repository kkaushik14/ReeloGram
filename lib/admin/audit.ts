import type { AdminResource } from "./config.ts";
import type { VerifiedAdminRequest } from "./signature.ts";

// Structured server logs use the hosting platform's access controls/retention.
// Only verified identities reach this function. Never spread a request/error here.
export function auditAdminAccess(
  identity: VerifiedAdminRequest,
  resource: AdminResource,
  status: number,
  write: (line: string) => void = console.info,
) {
  write(
    JSON.stringify({
      event: "admin.read",
      at: new Date().toISOString(),
      projectId: identity.projectId,
      environment: identity.environment,
      credentialId: identity.keyId,
      resource,
      status,
    }),
  );
}
