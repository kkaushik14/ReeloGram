import { enforceRateLimit } from "../security/rate-limit.ts";
export { RateLimitError } from "../security/rate-limit.ts";
const policies = {
  identify: [20, 120, 10 * 60], login: [12, 100, 15 * 60],
  complete: [5, 100, 15 * 60], register: [5, 40, 60 * 60],
  forgot: [3, 20, 15 * 60], reset: [10, 50, 15 * 60],
} as const;
export const limitAuth = (action: keyof typeof policies, subject: string, headers: Headers) =>
  enforceRateLimit(action, policies[action], subject, headers);
