import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  adminNotFound,
  type AdminConfiguration,
  type AdminResource,
} from "./config.ts";

export const ADMIN_SIGNATURE_VERSION = "2";
export type VerifiedAdminRequest = {
  projectId: string;
  environment: string;
  keyId: string;
  nonce: string;
};
/** Fixed positional JSON prevents delimiter ambiguity. No v1 signature fallback. */
export function adminSigningPayload(input: {
  projectId: string;
  environment: string;
  audience: string;
  keyId: string;
  method: string;
  path: string;
  time: string;
  nonce: string;
  body: string;
}) {
  return JSON.stringify([
    "reelogram-admin",
    ADMIN_SIGNATURE_VERSION,
    "read",
    input.projectId,
    input.environment,
    input.audience,
    input.keyId,
    input.method,
    input.path,
    input.time,
    input.nonce,
    createHash("sha256").update(input.body).digest("hex"),
  ]);
}
export function verifyAdminRequest(
  request: Request,
  resource: AdminResource,
  configuration: AdminConfiguration,
  now = Date.now(),
): VerifiedAdminRequest {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.pathname !== `/api/admin/v1/${resource}` ||
    url.search ||
    request.body ||
    (request.headers.get("content-length") &&
      request.headers.get("content-length") !== "0") ||
    request.headers.has("transfer-encoding")
  )
    adminNotFound();
  const h = request.headers;
  const projectId = h.get("x-admin-project") || "";
  const environment = h.get("x-admin-environment") || "";
  const audience = h.get("x-admin-audience") || "";
  const keyId = h.get("x-admin-key-id") || "";
  const time = h.get("x-admin-time") || "";
  const nonce = h.get("x-admin-nonce") || "";
  const signature = h.get("x-admin-signature") || "";
  const credential = configuration.credentials.find(
    (key) => key.id === keyId && (!key.expiresAt || key.expiresAt > now),
  );
  if (
    h.get("x-admin-version") !== ADMIN_SIGNATURE_VERSION ||
    h.get("x-admin-scope") !== "read" ||
    projectId !== configuration.projectId ||
    environment !== configuration.environment ||
    audience !== configuration.audience ||
    !credential ||
    !/^[0-9]{10}$/.test(time) ||
    Math.abs(Math.floor(now / 1000) - Number(time)) > 60 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      nonce,
    ) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    adminNotFound();
  const expected = createHmac("sha256", credential.secret)
    .update(
      adminSigningPayload({
        projectId,
        environment,
        audience,
        keyId,
        method: request.method,
        path: url.pathname + url.search,
        time,
        nonce,
        body: "",
      }),
    )
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
    adminNotFound();
  return { projectId, environment, keyId, nonce };
}
