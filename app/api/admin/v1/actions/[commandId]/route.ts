import { auditActionAccess } from "@/lib/admin/actions/audit";
import type { VerifiedAdminRequest } from "@/lib/admin/signature";
import { authenticateAction } from "@/lib/admin/actions/authenticate";
import { readCommand } from "@/lib/admin/actions/execute";
import { AdminRequestError } from "@/lib/admin/config";
import { adminFailure, adminHeaders } from "@/lib/admin/response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ commandId: string }> },
) {
  let verified: VerifiedAdminRequest | undefined;
  try {
    const { commandId } = await context.params;
    const { identity } = await authenticateAction(request, commandId);
    verified = identity;
    const result = await readCommand(identity.projectId, commandId);
    auditActionAccess(identity, "receipt", 200);
    return Response.json(result, {
      headers: adminHeaders,
    });
  } catch (error) {
    const response = adminFailure(error);
    if (verified) auditActionAccess(verified, "receipt", response.status);
    return response;
  }
}
const denied = () => adminFailure(new AdminRequestError(404, "Not found"));
export const POST = denied;
export const PUT = denied;
export const PATCH = denied;
export const DELETE = denied;
export const HEAD = denied;
export const OPTIONS = denied;
