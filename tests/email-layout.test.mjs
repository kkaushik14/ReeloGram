import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail } from "../lib/email/layout.ts";
import { accountCreatedEmail, passwordResetEmail, passwordChangedEmail } from "../lib/email/templates.ts";

test("email actions reject unsafe schemes, credentials and a different origin", () => {
  const content = { to: "a@example.invalid", subject: "Account", origin: "https://app.example", preview: "Preview", label: "Account", heading: "Hello", paragraphs: ["Your account."], action: { label: "Open", url: "https://app.example/login" } };
  for (const url of ["javascript:alert(1)", "http://untrusted.example", "https://user:secret@app.example/", "https://other.example/"]) {
    assert.throws(() => renderEmail({ ...content, action: { ...content.action, url } }));
  }
});

test("messages preserve a complete plain-text alternative and escape all user-facing content", () => {
  const welcome = accountCreatedEmail("a@example.invalid", '<img src=x onerror="alert(1)">', "https://app.example");
  assert.ok(!welcome.html.includes('<img src=x'));
  assert.ok(welcome.text.includes('<img src=x'));
  assert.ok(welcome.text.includes("https://app.example/"));
  const url = "https://app.example/reset-password#token=" + "x".repeat(43);
  const reset = passwordResetEmail("a@example.invalid", url);
  assert.ok(reset.text.includes(url));
  assert.ok(reset.text.includes("Terms of use: https://app.example/terms"));
  assert.ok(reset.html.includes('href="https://app.example/terms"'));
  assert.ok(reset.html.includes("because a password reset was requested"));
  assert.match(reset.text, /20 minutes/);
  assert.match(reset.html, /https:\/\/app\.example\/email-logo\.png/);
  assert.match(passwordChangedEmail("a@example.invalid", "https://app.example").text, /previous sign-ins have been closed/);
});
