import { createHash } from "node:crypto";
import { AdminRequestError, adminNotFound } from "../config.ts";
import { ADMIN_ACTIONS, type AdminAction } from "./config.ts";
export const COMMAND_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export type ActionInput = {
  commandId: string;
  action: AdminAction;
  target: string;
  reason: string;
  actor: string;
  expectedRevision: number;
  authorizedAt: number;
};
export function parseAction(
  raw: string,
  owner: string,
  now = Date.now(),
): ActionInput {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AdminRequestError(400, "Invalid action details.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AdminRequestError(400, "Invalid action details.");
  const b = value as Record<string, unknown>;
  if (
    Object.keys(b).sort().join(",") !==
      "action,actor,authorizedAt,commandId,expectedRevision,reason,target" ||
    typeof b.commandId !== "string" ||
    !COMMAND_ID.test(b.commandId) ||
    typeof b.action !== "string" ||
    !ADMIN_ACTIONS.includes(b.action as AdminAction) ||
    typeof b.target !== "string" ||
    !/^[a-f0-9]{24}$/.test(b.target) ||
    typeof b.reason !== "string" ||
    b.reason.trim().length < 5 ||
    b.reason.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(b.reason) ||
    !Number.isSafeInteger(b.expectedRevision) ||
    Number(b.expectedRevision) < 0 ||
    Number(b.expectedRevision) > 2147483646
  )
    throw new AdminRequestError(400, "Invalid action details.");
  if (
    b.actor !== owner ||
    !Number.isSafeInteger(b.authorizedAt) ||
    Number(b.authorizedAt) < Math.floor(now / 1000) - 300 ||
    Number(b.authorizedAt) > Math.floor(now / 1000) + 30
  )
    adminNotFound();
  return { ...b, reason: b.reason.trim() } as ActionInput;
}
/** Fresh owner authorization can be renewed on retries without changing intent. */
export function actionDigest(input: ActionInput) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.commandId,
        input.action,
        input.target,
        input.reason,
        input.actor,
        input.expectedRevision,
      ]),
    )
    .digest("hex");
}
export async function readActionBody(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json" ||
    request.headers.has("content-encoding")
  )
    adminNotFound();
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 8192))
    adminNotFound();
  const reader = request.body?.getReader();
  if (!reader) adminNotFound();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AdminRequestError(404, "Not found")),
      5000,
    );
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.length;
      if (size > 8192) adminNotFound();
      chunks.push(value);
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      );
    } catch {
      adminNotFound();
    }
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
