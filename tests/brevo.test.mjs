import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mailbox,
  brevoIdempotencyKey,
  brevoAccount,
  sendBrevo,
  BrevoQuotaError,
  BrevoUncertainError,
} from "../lib/email/brevo.ts";
import { brevoLimit } from "../lib/email/brevo-delivery.ts";

const message = {
  to: "recipient@example.invalid",
  subject: "Account update",
  html: "<p>Update</p>",
  text: "Update",
};
test("Brevo sends existing HTML and plain text with stable UUID idempotency and separate sender", async () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      REELOGRAM_BREVO_API_KEY: "test-key",
      REELOGRAM_EMAIL_FROM: "Fallback <smtp@example.invalid>",
      REELOGRAM_BREVO_EMAIL_FROM: "ReeloGram <hello@example.invalid>",
      REELOGRAM_EMAIL_REPLY_TO: "Support <help@example.invalid>",
    });
    await sendBrevo(message, "event-one", async (url, options) => {
      assert.equal(url, "https://api.brevo.com/v3/smtp/email");
      assert.equal(options.headers["api-key"], "test-key");
      assert.equal(options.redirect, "error");
      const body = JSON.parse(options.body);
      assert.deepEqual(body.sender, {
        name: "ReeloGram",
        email: "hello@example.invalid",
      });
      assert.deepEqual(body.replyTo, {
        name: "Support",
        email: "help@example.invalid",
      });
      assert.deepEqual(body.to, [{ email: message.to }]);
      assert.equal(body.htmlContent, message.html);
      assert.equal(body.textContent, message.text);
      assert.equal(
        body.headers.idempotencyKey,
        brevoIdempotencyKey("event-one"),
      );
      assert.match(
        body.headers.idempotencyKey,
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
      );
      return Response.json({ messageId: "test" }, { status: 201 });
    });
    assert.notEqual(
      brevoIdempotencyKey("event-one"),
      brevoIdempotencyKey("event-two"),
    );
    for (const status of [400, 402, 403])
      await assert.rejects(
        sendBrevo(message, "quota", async () =>
          Response.json({ code: "not_enough_credits" }, { status }),
        ),
        BrevoQuotaError,
      );
    for (const status of [400, 401, 403, 429])
      await assert.rejects(
        sendBrevo(message, "rejected", async () =>
          Response.json(
            { code: "unauthorized", message: "private provider detail" },
            { status },
          ),
        ),
        (error) =>
          !(error instanceof BrevoQuotaError) &&
          !error.message.includes("private"),
      );
    await assert.rejects(
      sendBrevo(message, "timeout", async () => {
        throw Error("private detail");
      }),
      BrevoUncertainError,
    );
    await assert.rejects(
      sendBrevo(
        message,
        "server-error",
        async () => new Response("private detail", { status: 503 }),
      ),
      BrevoUncertainError,
    );
    await sendBrevo(message, "duplicate", async () =>
      Response.json(
        { code: "duplicate_parameter", message: "idempotencyKey already used" },
        { status: 400 },
      ),
    );
    await assert.rejects(
      sendBrevo(message, "other-duplicate", async () =>
        Response.json(
          { code: "duplicate_parameter", message: "other duplicate" },
          { status: 400 },
        ),
      ),
      /rejected/,
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
test("Brevo credit checks exclude SMS, require active relay and reject unknown balances", async () => {
  const account =
    (plan, enabled = true) =>
    async () =>
      Response.json({ relay: { enabled }, plan });
  assert.equal(
    await brevoAccount(
      account([
        { type: "free", credits: 300 },
        { type: "sms", credits: 1000 },
      ]),
    ),
    300,
  );
  assert.equal(await brevoAccount(account([{ type: "free", credits: 0 }])), 0);
  await assert.rejects(
    brevoAccount(account([{ type: "free", credits: 300 }], false)),
    /not activated/,
  );
  await assert.rejects(
    brevoAccount(account([{ type: "sms", credits: 300 }])),
    /could not be verified/,
  );
  await assert.rejects(
    brevoAccount(account([{ type: "free", credits: -1 }])),
    /unknown/,
  );
  await assert.rejects(
    brevoAccount(async () => new Response("secret", { status: 401 })),
    /failed \(401\)/,
  );
});
test("sender parsing and free-plan limit reject unsafe configuration", () => {
  assert.deepEqual(mailbox("ReeloGram <hello@example.com>"), {
    name: "ReeloGram",
    email: "hello@example.com",
  });
  for (const value of [
    "invalid",
    "One <one@example.com>, Two <two@example.com>",
    "A\r\nB <a@example.com>",
  ])
    assert.throws(() => mailbox(value));
  const saved = process.env.REELOGRAM_BREVO_DAILY_LIMIT;
  try {
    for (const value of ["-1", "301", "1.5", "NaN"]) {
      process.env.REELOGRAM_BREVO_DAILY_LIMIT = value;
      assert.throws(() => brevoLimit());
    }
    process.env.REELOGRAM_BREVO_DAILY_LIMIT = "0";
    assert.equal(brevoLimit(), 0);
  } finally {
    if (saved === undefined) delete process.env.REELOGRAM_BREVO_DAILY_LIMIT;
    else process.env.REELOGRAM_BREVO_DAILY_LIMIT = saved;
  }
});
