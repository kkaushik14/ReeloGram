import { createHash } from "node:crypto";
import AdminNonce from "../../models/AdminNonce.ts";
import { connectToDatabase } from "../db.ts";
import { enforceRateLimit } from "../security/rate-limit.ts";
import {
  adminNotFound,
  adminConfiguration,
  type AdminResource,
} from "./config.ts";
import { verifyAdminRequest } from "./signature.ts";
import { auditAdminAccess } from "./audit.ts";
import { adminFailure } from "./response.ts";

export async function authenticateAdminRead(
  request: Request,
  resource: AdminResource,
) {
  const configuration = adminConfiguration();
  // Invalid signatures cannot reach MongoDB, Redis or provider APIs.
  const identity = verifyAdminRequest(request, resource, configuration);
  const { nonce } = identity;
  try {
    await enforceRateLimit(
      "admin-read",
      [120, 300, 60],
      configuration.projectId,
      request.headers,
    );
    await connectToDatabase();
    await AdminNonce.init();
    try {
      // Unique _id is shared across workers. MongoDB preserves replay protection even
      // if optional Redis cache keys are evicted. Expired timestamps remain invalid.
      await AdminNonce.create(
        [
          {
            _id: createHash("sha256")
              .update(`${configuration.projectId}:${nonce.toLowerCase()}`)
              .digest("hex"),
            // Extra second covers inclusive timestamp validation at second precision.
            expiresAt: new Date(Date.now() + 121000),
          },
        ],
        { writeConcern: { w: "majority", wtimeout: 3000 } },
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
      )
        adminNotFound();
      throw error;
    }
    return identity;
  } catch (error) {
    auditAdminAccess(identity, resource, adminFailure(error).status);
    throw error;
  }
}
