import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEmailAddress } from "../lib/email/address.ts";
import { isUnder13 } from "../lib/account/age.ts";
import { accountAccess } from "../lib/account/access.ts";
import { requestedParent } from "../lib/account/parent.ts";
import {
  createConfirmation,
  confirmationDigest,
} from "../lib/account/confirmation.ts";

test("email syntax, temporary domains, null MX and transient DNS failures are distinguished", async () => {
  let queries = 0;
  const mx = async () => {
    queries++;
    return [{ exchange: "mx.example.org", priority: 10 }];
  };
  assert.equal(
    await validateEmailAddress("user+tag@gmail.com", mx),
    "user+tag@gmail.com",
  );
  await validateEmailAddress("second@gmail.com", mx);
  assert.equal(
    queries,
    1,
    "Domain checks must be cached, not repeated per mailbox",
  );
  for (const address of [
    "bad",
    "a@mailinator.com",
    "a@sub.mailinator.com",
    "a@10minutemail.com",
    "check@digeros.com",
    " CHECK@DIGEROS.COM ",
    "check@sub.digeros.com",
  ])
    await assert.rejects(
      validateEmailAddress(address, mx),
      (error) => error.status === 400,
    );
  await assert.rejects(
    validateEmailAddress("a@null-mx.example", async () => [
      { exchange: ".", priority: 0 },
    ]),
    (error) => error.status === 400,
  );
  await assert.rejects(
    validateEmailAddress("a@absent-mx.example", async () => []),
    (error) => error.status === 400,
  );
  await assert.rejects(
    validateEmailAddress("a@timeout-mx.example", async () => {
      throw Object.assign(Error(), { code: "ETIMEOUT" });
    }),
    (error) => error.status === 503,
  );
});
test("newly listed disposable domains are rejected before DNS, including parent addresses", async () => {
  let queries = 0;
  const mx = async () => {
    queries++;
    return [{ exchange: "mx.example.org", priority: 10 }];
  };
  await assert.rejects(
    validateEmailAddress("regression@digeros.com", mx),
    /Temporary email/,
  );
  assert.equal(queries, 0);
  await assert.rejects(
    requestedParent(
      { parentEmail: "parent@digeros.com", parentManaged: true },
      new Date("2018-04-12"),
      "child@example.org",
    ),
    /Parent email:.*Temporary email/,
  );
  assert.equal(
    await validateEmailAddress("person@notdigeros.com", mx),
    "person@notdigeros.com",
  );
  assert.equal(
    await validateEmailAddress("person@digeros.com.example.org", mx),
    "person@digeros.com.example.org",
  );
});
test("parent management respects the exact thirteenth birthday and confirmation boundaries", async () => {
  const today = new Date("2026-11-06T00:00:00Z");
  assert.equal(isUnder13("2013-11-06", today), false);
  assert.equal(isUnder13("2013-11-07", today), true);
  const birthday = new Date("2018-04-12T00:00:00Z");
  const validate = async (value) => String(value).trim().toLowerCase();
  await assert.rejects(
    requestedParent({}, birthday, "child@example.org", validate),
    /parent or guardian/,
  );
  await assert.rejects(
    requestedParent(
      { parentManaged: true, parentEmail: "CHILD@example.org" },
      birthday,
      "child@example.org",
      validate,
    ),
    /different email/,
  );
  const parent = await requestedParent(
    { parentManaged: true, parentEmail: "parent@example.org" },
    birthday,
    "child@example.org",
    validate,
  );
  assert.ok(parent.token);
  assert.ok(!JSON.stringify(parent.record).includes(parent.token));
  assert.equal(
    accountAccess({ emailVerifiedAt: new Date(), dateOfBirth: birthday })
      .canPublish,
    false,
  );
  assert.equal(
    accountAccess({
      emailVerifiedAt: new Date(),
      dateOfBirth: birthday,
      parent: { verifiedAt: new Date() },
    }).canPublish,
    false,
  );
  assert.equal(
    accountAccess({
      name: "Young Creator",
      emailVerifiedAt: new Date(),
      dateOfBirth: birthday,
      parent: { verifiedAt: new Date(), ownerApprovedAt: new Date() },
    }).canPublish,
    true,
  );
});
test("confirmation tokens are unpredictable, expire, and cannot be reused for a different purpose", () => {
  const first = createConfirmation("email"),
    second = createConfirmation("email");
  assert.notEqual(first.token, second.token);
  assert.equal(first.stored.digest, confirmationDigest("email", first.token));
  assert.notEqual(
    first.stored.digest,
    confirmationDigest("parent", first.token),
  );
  assert.ok(first.stored.expiresAt.getTime() > Date.now() + 23 * 3600000);
  assert.ok(!JSON.stringify(first.stored).includes(first.token));
});
