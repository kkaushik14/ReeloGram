import { Client, Receiver } from "@upstash/qstash";
import { appOrigin } from "../../config/app-url.ts";
export function queueConfig() {
  const token = process.env.REELOGRAM_QSTASH_TOKEN;
  const currentSigningKey = process.env.REELOGRAM_QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.REELOGRAM_QSTASH_NEXT_SIGNING_KEY;
  const url = new URL(
    process.env.REELOGRAM_QSTASH_URL || "https://qstash.upstash.io",
  );
  if (
    url.protocol !== "https:" ||
    !/^qstash(?:-[a-z0-9-]+)?\.upstash\.io$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw Error("Invalid upload queue URL");
  if (!token || !currentSigningKey || !nextSigningKey)
    throw Error("Upload queue is not configured");
  return { token, currentSigningKey, nextSigningKey, baseUrl: url.origin };
}
export function processingUrl() {
  return `${callbackOrigin()}/api/uploads/process`;
}
export function maintenanceUrl() {
  return `${callbackOrigin()}/api/uploads/maintenance`;
}
function callbackOrigin() {
  // Optional explicit webhook origin for local HTTPS tunnels; never trust request headers.
  const configured = process.env.REELOGRAM_UPLOAD_CALLBACK_ORIGIN;
  return configured
    ? appOrigin({ REELOGRAM_APP_URL: configured })
    : appOrigin();
}
export async function enqueueUpload(id: string) {
  const config = queueConfig();
  const client = new Client({
    token: config.token,
    baseUrl: config.baseUrl,
    retry: { retries: 1 },
  });
  return client.publishJSON({
    url: processingUrl(),
    body: { id },
    retries: 12,
    timeout: 55,
    flowControl: { key: "reelogram-uploads", parallelism: 2 },
  });
}
export async function verifyUploadRequest(signature: string, body: string) {
  try {
    return await new Receiver(queueConfig()).verify({
      signature,
      body,
      url: processingUrl(),
    });
  } catch {
    return false;
  }
}
