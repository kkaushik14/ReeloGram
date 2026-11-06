import { auditActionAccess } from "./audit.ts";
import { adminFailure } from "../response.ts";
import { adminConfiguration, adminNotFound } from "../config.ts";
import { verifySignedRequest } from "../signature.ts";
import { consumeAdminNonce } from "../authenticate.ts";
import { enforceRateLimit } from "../../security/rate-limit.ts";
import { actionConfiguration } from "./config.ts";
import { COMMAND_ID, readActionBody } from "./input.ts";
export async function authenticateAction(request: Request, commandId?: string) {
  const config = actionConfiguration(adminConfiguration());
  if (commandId !== undefined && !COMMAND_ID.test(commandId)) adminNotFound();
  if (
    request.headers.get("x-admin-key-id") !== config.credentials[0].id ||
    request.headers.get("x-admin-scope") !== "actions" ||
    request.headers.get("x-admin-version") !== "2" ||
    !/^[a-f0-9]{64}$/.test(request.headers.get("x-admin-signature") || "")
  )
    adminNotFound();
  const body = commandId === undefined ? await readActionBody(request) : "";
  const identity = verifySignedRequest(request, config, {
    method: commandId === undefined ? "POST" : "GET",
    path: `/api/admin/v1/actions${commandId === undefined ? "" : "/" + commandId}`,
    scope: "actions",
    body,
  });
  try {
    await enforceRateLimit(
      commandId === undefined ? "admin-action" : "admin-command-read",
      commandId === undefined ? [30, 60, 60] : [120, 300, 60],
      config.projectId,
      request.headers,
    );
    await consumeAdminNonce(config.projectId, identity.nonce);
    return { identity, config, body };
  } catch (error) {
    auditActionAccess(
      identity,
      commandId === undefined ? "execute" : "receipt",
      adminFailure(error).status,
    );
    throw error;
  }
}
