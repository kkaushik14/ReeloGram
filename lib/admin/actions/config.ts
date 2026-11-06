import { adminNotFound, type AdminConfiguration } from "../config.ts";
export const ADMIN_ACTIONS = [
  "accounts.suspend",
  "accounts.restore",
  "videos.hide",
  "videos.restore",
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];
export function actionConfiguration(
  base: AdminConfiguration,
  env = process.env,
) {
  const id = env.REELOGRAM_ADMIN_WRITE_KEY_ID || "";
  const secret = env.REELOGRAM_ADMIN_WRITE_SECRET || "";
  const owner = env.REELOGRAM_ADMIN_OWNER_ID || "";
  const allowed = (env.REELOGRAM_ADMIN_ACTIONS || "")
    .split(",")
    .map((v) => v.trim());
  if (
    env.REELOGRAM_ADMIN_ACTIONS_ENABLED !== "1" ||
    !/^[a-z][a-z0-9-]{1,39}$/.test(id) ||
    secret.length < 32 ||
    secret.length > 256 ||
    secret.trim() !== secret ||
    /[\r\n]/.test(secret) ||
    secret === env.REELOGRAM_NEXTAUTH_SECRET ||
    [env.REELOGRAM_ADMIN_SECRET, env.REELOGRAM_ADMIN_PREVIOUS_SECRET].includes(
      secret,
    ) ||
    [env.REELOGRAM_ADMIN_KEY_ID, env.REELOGRAM_ADMIN_PREVIOUS_KEY_ID].includes(
      id,
    ) ||
    !/^[a-zA-Z0-9:_-]{1,200}$/.test(owner) ||
    !allowed.length ||
    new Set(allowed).size !== allowed.length ||
    allowed.some((v) => !ADMIN_ACTIONS.includes(v as AdminAction))
  )
    adminNotFound();
  return {
    ...base,
    credentials: [{ id, secret }],
    owner,
    allowed: allowed as AdminAction[],
  };
}
export function enabledActions(
  base: AdminConfiguration,
  env = process.env,
): AdminAction[] {
  try {
    return actionConfiguration(base, env).allowed;
  } catch {
    return [];
  }
}
