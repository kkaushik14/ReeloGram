import { auditActionAccess } from "@/lib/admin/actions/audit";
import type { VerifiedAdminRequest } from "@/lib/admin/signature";
import { authenticateAction } from "@/lib/admin/actions/authenticate";
import { parseAction } from "@/lib/admin/actions/input";
import { executeAction } from "@/lib/admin/actions/execute";
import { adminNotFound, AdminRequestError } from "@/lib/admin/config";
import { adminFailure, adminHeaders } from "@/lib/admin/response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let verified: VerifiedAdminRequest | undefined;
  try {
    const { identity, config, body } = await authenticateAction(request);
    verified = identity;
    const input = parseAction(body, config.owner);
    if (!config.allowed.includes(input.action)) adminNotFound();
    const result = await executeAction(input, identity);
    auditActionAccess(identity, "execute", 200);
    return Response.json(result, {
      headers: adminHeaders,
    });
  } catch (error) {
    const response = adminFailure(error);
    if (verified) auditActionAccess(verified, "execute", response.status);
    return response;
  }
}
const denied = () => adminFailure(new AdminRequestError(404, "Not found"));
export const GET = denied;
export const PUT = denied;
export const PATCH = denied;
export const DELETE = denied;
export const HEAD = denied;
export const OPTIONS = denied;
