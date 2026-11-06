import {
  ADMIN_CAPABILITIES,
  ADMIN_RESOURCES,
  AdminRequestError,
  type AdminResource,
} from "@/lib/admin/config";
import { authenticateAdminRead } from "@/lib/admin/authenticate";
import { readAccounts, readVideos, readJobs } from "@/lib/admin/queries";
import { auditAdminAccess } from "@/lib/admin/audit";
import type { VerifiedAdminRequest } from "@/lib/admin/signature";
import { adminFailure, adminHeaders } from "@/lib/admin/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  let identity: VerifiedAdminRequest | undefined;
  const { resource } = await context.params;
  try {
    if (!ADMIN_RESOURCES.includes(resource as AdminResource))
      throw new AdminRequestError(404, "Not found");
    identity = await authenticateAdminRead(request, resource as AdminResource);
    const data =
      resource === "manifest"
        ? {
            projectId: identity.projectId,
            version: "1",
            capabilities: ADMIN_CAPABILITIES,
          }
        : resource === "accounts"
          ? await readAccounts()
          : resource === "videos"
            ? await readVideos()
            : await readJobs();
    auditAdminAccess(identity, resource as AdminResource, 200);
    return Response.json(data, { headers: adminHeaders });
  } catch (error) {
    const response = adminFailure(error);
    if (identity)
      auditAdminAccess(identity, resource as AdminResource, response.status);
    return response;
  }
}

// Explicitly reject writes and HEAD (which Next otherwise implements via GET).
function unsupported() {
  return adminFailure(new AdminRequestError(404, "Not found"));
}
export const POST = unsupported;
export const PATCH = unsupported;
export const PUT = unsupported;
export const DELETE = unsupported;
export const HEAD = unsupported;
export const OPTIONS = unsupported;
