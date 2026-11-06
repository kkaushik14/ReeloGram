import { test } from "node:test";
import assert from "node:assert/strict";
import {
  passwordError,
  passwordCounts,
  passwordStrength,
} from "../lib/auth/password-policy.ts";
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
    "velvet otters sail eastward 42!",
    "  copper sails beyond winter 29#  ",
    "晴れた空の下で青い鳥が静かに歌います42!",
    "rV2&v!fa92noPq7@w",
  ])
    assert.equal(passwordError(value), null, value);
});
test("two ASCII numbers and a punctuation or symbol character are required", () => {
  for (const value of [
    "velvet otters sail eastward!",
    "velvet otters sail eastward1!",
    "velvet otters sail eastward12 ",
    "velvet otters sail eastward12\t",
    "velvet otters sail eastward１２!",
  ])
    assert.ok(passwordError(value), value);
  assert.equal(passwordError("velvet otters sail eastward12🔑"), null);
  assert.deepEqual(passwordCounts("Birds12!🔑 "), {
    characters: 10,
    numbers: 2,
    specialCharacters: 2,
  });
});
test("strength is low for invalid passwords and increases with length and composition", () => {
  assert.equal(passwordStrength(""), "Low");
  assert.equal(
    passwordStrength("long phrase without any numbers or symbols"),
    "Low",
  );
  assert.equal(passwordStrength("password123456789!!!!"), "Low");
  assert.equal(passwordStrength("Cedar27!"), "Moderate");
  assert.equal(passwordStrength("Cedar-lake27!skylark8"), "High");
  assert.equal(passwordStrength("velvet otters sail eastward 12!"), "High");
  assert.equal(
    passwordStrength("longaccountname123!", "longaccountname@example.com"),
    "Low",
  );
  assert.equal(passwordStrength("Violet ocean 123!".repeat(6)), "Low");
});
test("the eight-character boundary counts Unicode code points", () => {
  assert.ok(passwordError("Ceda27!"));
  assert.equal(passwordError("Cedar27!"), null);
  assert.ok(passwordError("é山🔑a27!"));
  assert.equal(passwordError("é山🔑ab27!"), null);
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
