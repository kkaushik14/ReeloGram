import {
  createSignInGrant,
  signInGrantDigest,
} from "../lib/auth/sign-in-grant.ts";
import { safeAuthDestination } from "../lib/auth/navigation.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEmail,
  parseProfile,
  passwordError,
  validResetToken,
} from "../lib/auth/validation.ts";
import {
  passwordResetEmail,
  videoPostedEmail,
} from "../lib/email/templates.ts";
import { sendEmail, appOrigin } from "../lib/email/transport.ts";
test("account fields reject injection objects, control characters and impossible/private profile dates", () => {
  assert.equal(parseEmail({ $ne: null }), null);
  for (const value of [
    "a,b@example.com",
    "a@example.com;evil",
    "a..b@example.com",
    "a@ｅxample.com",
    "a＠example.com",
  ]) {
    assert.equal(parseEmail(value), null);
  }
  assert.equal(parseEmail("a\r\nb@example.com"), null);
  assert.equal(parseEmail(" <a>@b.co "), null);
  assert.equal(parseEmail(" Person@Example.com "), "person@example.com");
  const now = new Date("2026-11-05T12:00:00Z");
  for (const dateOfBirth of [
    "2026-02-31",
    "2027-01-01",
    "1800-01-01",
    { $gt: "" },
    "2020-2-1",
  ]) {
    assert.equal(parseProfile({ name: "A person", dateOfBirth }, now), null);
  }
  assert.equal(
    parseProfile({ name: "A\nB", dateOfBirth: "2000-01-01" }, now),
    null,
  );
  assert.equal(
    parseProfile({ name: "  A   Person  ", dateOfBirth: "2000-02-29" }, now)
      .name,
    "A Person",
  );
  assert.ok(passwordError("short"));
  assert.ok(passwordError(" ".repeat(8)));
  assert.ok(passwordError("🔑".repeat(19)));
  assert.equal(passwordError("use a long passphrase"), null);
  assert.equal(validResetToken({ $ne: "" }), false);
  assert.equal(validResetToken("x".repeat(43)), true);
});
test("email templates escape untrusted names, titles and link values", () => {
  const email = videoPostedEmail(
    "a@example.com",
    '<script>"hello"</script>',
    "https://app.example/?x=1&y=2",
  );
  assert.ok(!email.html.includes("<script>"));
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.html, /&amp;y/);
  assert.match(
    passwordResetEmail(
      "a@example.com",
      "https://app.example/reset-password#token=x",
    ).text,
    /20 minutes/,
  );
});
test("Resend transport is reusable, authenticated and uses stable idempotency keys without leaking responses", async () => {
  const saved = { ...process.env };
  const original = globalThis.fetch;
  try {
    process.env.REELOGRAM_RESEND_API_KEY = "test-provider-key";
    process.env.REELOGRAM_EMAIL_FROM = "hello@example.com";
    delete process.env.REELOGRAM_EMAIL_PROVIDER;
    process.env.REELOGRAM_APP_URL = "https://app.example";
    let input;
    globalThis.fetch = async (url, options) => {
      input = { url, ...options };
      return new Response(JSON.stringify({ id: "mail" }), { status: 200 });
    };
    await sendEmail(
      passwordResetEmail(
        "a@example.com",
        "https://app.example/reset-password#token=x",
      ),
      "event-once",
    );
    assert.equal(input.url, "https://api.resend.com/emails");
    assert.equal(input.headers["Idempotency-Key"], "event-once");
    assert.equal(input.headers.Authorization, "Bearer test-provider-key");
    assert.deepEqual(JSON.parse(input.body).to, ["a@example.com"]);
    globalThis.fetch = async () =>
      new Response("private provider details", { status: 429 });
    await assert.rejects(
      sendEmail(
        passwordResetEmail("a@example.com", "https://app.example"),
        "event-once",
      ),
      (error) => error.message === "Email delivery failed (429)",
    );
    process.env.REELOGRAM_APP_URL = "http://untrusted.example";
    assert.throws(() => appOrigin());
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
});

test("sign-in grants are unpredictable, short-lived and purpose-bound; redirects remain internal", () => {
  const first = createSignInGrant(),
    second = createSignInGrant();
  assert.notEqual(first.token, second.token);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.stored.digest, signInGrantDigest(first.token));
  assert.ok(!JSON.stringify(first.stored).includes(first.token));
  assert.ok(
    first.stored.expiresAt > Date.now() &&
      first.stored.expiresAt <= Date.now() + 60000,
  );
  assert.equal(
    safeAuthDestination("https://evil.example/a", "https://app.example"),
    "/",
  );
  assert.equal(
    safeAuthDestination("/api/auth/signout", "https://app.example"),
    "/",
  );
  assert.equal(
    safeAuthDestination("/upload?from=welcome", "https://app.example"),
    "/upload?from=welcome",
  );
});
