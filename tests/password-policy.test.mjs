import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordError } from "../lib/auth/password-policy.ts";
import { parseCredentials } from "../lib/credentials.ts";
test("new passwords reject nonstrings, short, repeated, numeric and common variants", () => {
  for (const value of [
    null,
    {},
    ["a"],
    "short",
    "a".repeat(20),
    "12345678901234567890",
    "Password123456789!",
    "qwerty1234567890!",
    "passwordpassword",
    " ".repeat(20),
    "abcdefghijklmnop",
    "correct horse battery staple",
  ])
    assert.ok(passwordError(value), String(value));
});
test("passphrases and unicode are accepted without changing the supplied secret", () => {
  for (const value of [
    "velvet otters sail eastward",
    "  copper sails beyond winter  ",
    "晴れた空の下で青い鳥が静かに歌います",
    "rV2&v!fa92noPq7@w",
  ])
    assert.equal(passwordError(value), null, value);
});
test("bcrypt byte boundary, Unicode character counting and identity checks", () => {
  assert.equal(passwordError("aB9!".repeat(17) + "Xy7?"), null); // 72 bytes, not a trivial one-to-eight-character repetition
  assert.ok(passwordError("aB9!".repeat(18) + "z"));
  assert.ok(passwordError("🔑".repeat(8))); // 16 UTF-16 units but only eight characters
  assert.ok(passwordError("🔑".repeat(19)));
  assert.ok(passwordError("person@example.com", "person@example.com"));
  assert.ok(
    passwordError("longaccountname123!", "longaccountname@example.com"),
  );
  assert.ok(
    parseCredentials({ email: "person@example.com", password: "old-pass" }),
    "Existing passwords must remain usable at login",
  );
});
