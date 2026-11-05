import { test } from "node:test";
import assert from "node:assert/strict";
import { validCronAuthorization } from "../lib/security/cron.ts";

test("scheduled refresh rejects missing, malformed and incorrect credentials", () => {
  const secret = "a".repeat(64);
  assert.equal(validCronAuthorization(`Bearer ${secret}`, secret), true);
  for (const header of [
    null,
    "",
    secret,
    "Bearer wrong",
    `bearer ${secret}`,
    `Bearer ${secret} `,
  ])
    assert.equal(validCronAuthorization(header, secret), false);
  assert.equal(validCronAuthorization(`Bearer ${secret}`, undefined), false);
  assert.equal(validCronAuthorization("Bearer short", "short"), false);
});
