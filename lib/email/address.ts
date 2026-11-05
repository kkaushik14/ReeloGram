import { Resolver } from "node:dns/promises";
import MailChecker from "mailchecker";
import { isSupplementaryDisposableDomain } from "./disposable.ts";
import { parseEmail } from "../auth/validation.ts";
import { AuthRequestError } from "../security/request.ts";

const cache = new Map<string, { expires: number; result: Promise<boolean> }>();
const resolver = new Resolver({ timeout: 1200, tries: 1 });
export async function validateEmailAddress(
  value: unknown,
  lookup = (domain: string) => resolver.resolveMx(domain),
) {
  const email = parseEmail(value);
  if (!email) throw new AuthRequestError("Enter a valid email address.");
  const domain = email.split("@")[1];
  if (
    !MailChecker.isValid(email) ||
    (await isSupplementaryDisposableDomain(domain))
  )
    throw new AuthRequestError(
      "Use a permanent email address. Temporary email services are not supported.",
    );
  // Reserved fixtures are accepted only by the isolated development test server.
  if (
    process.env.NODE_ENV === "development" &&
    process.env.REELOGRAM_E2E_DIST_DIR &&
    domain === "example.invalid"
  )
    return email;
  const key = domain;
  let entry = cache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    if (cache.size >= 512) cache.delete(cache.keys().next().value!);
    const result = lookup(domain)
      .then((records) =>
        records.some((record) => !!record.exchange && record.exchange !== "."),
      )
      .catch((error: unknown) => {
        const code =
          error && typeof error === "object" && "code" in error
            ? error.code
            : null;
        if (code === "ENOTFOUND" || code === "ENODATA") return false;
        cache.delete(key);
        throw new AuthRequestError(
          "We couldn’t check this email domain right now. Please try again shortly.",
          503,
        );
      });
    entry = { expires: Date.now() + 15 * 60 * 1000, result };
    cache.set(key, entry);
  }
  if (!(await entry.result))
    throw new AuthRequestError(
      "This email domain is not configured to receive email. Check the address and try again.",
    );
  return email;
}
