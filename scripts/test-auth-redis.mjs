import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { actionServer } from "./testing/admin-action-server.mjs";
let h;
try {
  h = await actionServer();
  await h.fault("healthy");
  await h.start({
    NODE_OPTIONS: `--import ${JSON.stringify(resolve("scripts/testing/auth-redis-adapter.mjs"))}`,
    REELOGRAM_REDIS_DISABLED: "0",
    REELOGRAM_KV_REST_API_URL: "https://auth-test.upstash.io",
    REELOGRAM_KV_REST_API_TOKEN: "synthetic-test-token",
    REELOGRAM_EMAIL_PROVIDER: "disabled",
  });
  const token = randomBytes(32).toString("base64url");
  const call = async (status) => {
    const response = await fetch(`${h.base}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: h.base },
      body: JSON.stringify({ token, password: "Cedar27!" }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    assert.equal(response.status, status, result.error);
    return result;
  };
  // First database-using request in this child: no earlier page/session may warm MongoDB.
  assert.match((await call(400)).error, /reset link is invalid/);
  const id = new Types.ObjectId();
  await h.db.collection("users").insertOne({
    _id: id,
    email: "cold-auth@example.invalid",
    password: await bcrypt.hash("legacy-pass", 10),
    sessionVersion: 0,
    passwordReset: {
      digest: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  assert.ok((await call(200)).signInToken);
  const user = await h.db.collection("users").findOne({ _id: id });
  assert.ok(await bcrypt.compare("Cedar27!", user.password));
  assert.equal(user.sessionVersion, 1);
  assert.equal(user.passwordReset, undefined);
  await call(400);
  await h.fault("quota");
  await call(503);
  assert.equal(await h.db.collection("auth_rate_limits").countDocuments({}), 0);
  console.log(
    "Cold Redis-backed password reset, eight-character acceptance, token replay, session revocation and fail-closed quota checks passed.",
  );
} catch (error) {
  console.error(error);
  if (h) console.error(h.logs);
  process.exitCode = 1;
} finally {
  if (h) await h.close();
}
