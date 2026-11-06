import { auditActionAccess } from "../lib/admin/actions/audit.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { adminConfiguration } from "../lib/admin/config.ts";
import {
  actionConfiguration,
  enabledActions,
  ADMIN_ACTIONS,
} from "../lib/admin/actions/config.ts";
import {
  parseAction,
  actionDigest,
  readActionBody,
} from "../lib/admin/actions/input.ts";
import {
  adminSigningPayload,
  verifySignedRequest,
} from "../lib/admin/signature.ts";
const env = {
  REELOGRAM_ADMIN_ENABLED: "1",
  REELOGRAM_ADMIN_PROJECT_ID: "reelogram-test",
  REELOGRAM_ADMIN_ENVIRONMENT: "local",
  REELOGRAM_ADMIN_AUDIENCE: "http://localhost:3000",
  REELOGRAM_ADMIN_KEY_ID: "read-key",
  REELOGRAM_ADMIN_SECRET: "a".repeat(64),
  REELOGRAM_ADMIN_ACTIONS_ENABLED: "1",
  REELOGRAM_ADMIN_WRITE_KEY_ID: "write-key",
  REELOGRAM_ADMIN_WRITE_SECRET: "b".repeat(64),
  REELOGRAM_ADMIN_OWNER_ID: "google:12345",
  REELOGRAM_ADMIN_ACTIONS: ADMIN_ACTIONS.join(","),
};
const base = adminConfiguration(env),
  now = Date.now();
const input = () => ({
  commandId: randomUUID(),
  action: "accounts.suspend",
  target: "a".repeat(24),
  reason: "Reported abuse verified",
  actor: env.REELOGRAM_ADMIN_OWNER_ID,
  expectedRevision: 0,
  authorizedAt: Math.floor(now / 1000),
});
test("write access requires explicit capabilities, owner and an independent credential", () => {
  assert.equal(actionConfiguration(base, env).credentials[0].id, "write-key");
  assert.deepEqual(enabledActions(base, {}), []);
  for (const patch of [
    { REELOGRAM_ADMIN_ACTIONS_ENABLED: "0" },
    { REELOGRAM_ADMIN_OWNER_ID: "" },
    { REELOGRAM_ADMIN_ACTIONS: "*" },
    { REELOGRAM_ADMIN_ACTIONS: "accounts.delete" },
    { REELOGRAM_ADMIN_ACTIONS: "accounts.suspend,accounts.suspend" },
    { REELOGRAM_ADMIN_WRITE_SECRET: env.REELOGRAM_ADMIN_SECRET },
    { REELOGRAM_ADMIN_PREVIOUS_SECRET: env.REELOGRAM_ADMIN_WRITE_SECRET },
    { REELOGRAM_ADMIN_WRITE_KEY_ID: env.REELOGRAM_ADMIN_KEY_ID },
    { REELOGRAM_ADMIN_WRITE_SECRET: "short" },
    { REELOGRAM_NEXTAUTH_SECRET: env.REELOGRAM_ADMIN_WRITE_SECRET },
  ]) {
    assert.throws(
      () => actionConfiguration(base, { ...env, ...patch }),
      (e) => e.status === 404,
    );
    assert.deepEqual(enabledActions(base, { ...env, ...patch }), []);
  }
});
test("actions require a fresh trusted owner, valid target/revision/reason and exact fields", () => {
  const body = input();
  assert.deepEqual(parseAction(JSON.stringify(body), body.actor, now), body);
  for (const patch of [
    { target: { $ne: null } },
    { target: "../users" },
    { expectedRevision: -1 },
    { expectedRevision: 0.5 },
    { reason: "x" },
    { reason: "x\nyyyyy" },
    { reason: "x".repeat(501) },
    { actor: "another" },
    { authorizedAt: Math.floor(now / 1000) - 301 },
    { authorizedAt: Math.floor(now / 1000) + 31 },
    { force: true },
    { action: "users.delete" },
    { commandId: "bad" },
  ])
    assert.throws(() =>
      parseAction(JSON.stringify({ ...body, ...patch }), body.actor, now),
    );
  assert.equal(
    actionDigest(body),
    actionDigest({ ...body, authorizedAt: body.authorizedAt + 1 }),
  );
  for (const patch of [
    { target: "b".repeat(24) },
    { reason: "Different intent" },
    { expectedRevision: 1 },
    { action: "accounts.restore" },
  ])
    assert.notEqual(actionDigest(body), actionDigest({ ...body, ...patch }));
});
test("write signatures bind exact raw body, path, scope and independent key", () => {
  const config = actionConfiguration(base, env),
    time = String(Math.floor(now / 1000)),
    nonce = randomUUID(),
    body = JSON.stringify(input()),
    path = "/api/admin/v1/actions";
  const headers = {
    "Content-Type": "application/json",
    "X-Admin-Version": "2",
    "X-Admin-Scope": "actions",
    "X-Admin-Project": base.projectId,
    "X-Admin-Environment": base.environment,
    "X-Admin-Audience": base.audience,
    "X-Admin-Key-Id": "write-key",
    "X-Admin-Time": time,
    "X-Admin-Nonce": nonce,
  };
  const payload = {
    projectId: base.projectId,
    environment: base.environment,
    audience: base.audience,
    keyId: "write-key",
    method: "POST",
    path,
    time,
    nonce,
    body,
    scope: "actions",
  };
  headers["X-Admin-Signature"] = createHmac(
    "sha256",
    env.REELOGRAM_ADMIN_WRITE_SECRET,
  )
    .update(adminSigningPayload(payload))
    .digest("hex");
  const req = () =>
    new Request(base.audience + path, { method: "POST", headers, body });
  verifySignedRequest(
    req(),
    config,
    { method: "POST", path, scope: "actions", body },
    now,
  );
  for (const patch of [
    { body: body + " " },
    { path: path + "/other" },
    { scope: "read" },
    { method: "GET" },
  ])
    assert.throws(
      () =>
        verifySignedRequest(
          req(),
          config,
          { method: "POST", path, scope: "actions", body, ...patch },
          now,
        ),
      (e) => e.status === 404,
    );
  assert.throws(
    () =>
      verifySignedRequest(
        req(),
        base,
        { method: "POST", path, scope: "actions", body },
        now,
      ),
    (e) => e.status === 404,
  );
});
test("action bodies have strict content type, byte and UTF-8 bounds", async () => {
  const request = (body, headers = {}) =>
    new Request("http://localhost/actions", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", ...headers },
    });
  assert.equal(await readActionBody(request("{}")), "{}");
  for (const req of [
    request("x".repeat(8193)),
    request("{}", { "Content-Type": "text/plain" }),
    request("{}", { "Content-Encoding": "gzip" }),
    request(new Uint8Array([255])),
  ])
    await assert.rejects(
      () => readActionBody(req),
      (e) => e.status === 404,
    );
});

test("operational action logs contain only allowlisted metadata", () => {
  const lines = [];
  auditActionAccess(
    {
      projectId: "test",
      environment: "local",
      keyId: "write-key",
      nonce: "private-nonce",
      secret: "private-secret",
    },
    "execute",
    503,
    (line) => lines.push(line),
  );
  const entry = JSON.parse(lines[0]);
  assert.deepEqual(
    Object.keys(entry).sort(),
    [
      "event",
      "at",
      "projectId",
      "environment",
      "credentialId",
      "operation",
      "status",
    ].sort(),
  );
  assert.equal(entry.status, 503);
  assert.equal(lines[0].includes("private-"), false);
});
