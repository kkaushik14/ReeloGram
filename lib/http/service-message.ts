/** Shared, public copy only: never expose provider responses or credentials. */
export const SERVICE_UNAVAILABLE_MESSAGE =
  "This service is temporarily unavailable. Please wait a moment before trying again.";
export const RATE_LIMIT_MESSAGE =
  "Too many requests. Please wait before trying again.";

export function serviceMessage(status: number, fallback: string) {
  if (status === 503) return SERVICE_UNAVAILABLE_MESSAGE;
  if (status === 429) return RATE_LIMIT_MESSAGE;
  return fallback;
}
