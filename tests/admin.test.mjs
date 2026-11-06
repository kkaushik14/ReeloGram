import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  adminConfiguration,
  AdminRequestError,
  ADMIN_CAPABILITIES,
} from "../lib/admin/config.ts";
import {
  verifyAdminRequest,
  adminSigningPayload,
} from "../lib/admin/signature.ts";
import { auditAdminAccess } from "../lib/admin/audit.ts";
const now = 1793920000000;
const secret = "a".repeat(64);
const env = {
  REELOGRAM_ADMIN_ENABLED: "1",
  REELOGRAM_ADMIN_PROJECT_ID: "reelogram-test",
  REELOGRAM_ADMIN_ENVIRONMENT: "production",
  REELOGRAM_ADMIN_AUDIENCE: "https://example.invalid",
  REELOGRAM_ADMIN_KEY_ID: "key-one",
  REELOGRAM_ADMIN_SECRET: secret,
};
const config = adminConfiguration(env, now);
const notFound = (e) =>
  e instanceof AdminRequestError &&
  e.status === 404 &&
  e.message === "Not found";
function signed({
  time = String(now / 1000),
  nonce = randomUUID(),
  path = "/api/admin/v1/accounts",
  key = secret,
  keyId = "key-one",
  projectId = config.projectId,
  environment = config.environment,
  audience = config.audience,
  changes = {},
  method = "GET",
  body = "",
  version = "2",
  scope = "read",
} = {}) {
  // Independent encoder: validates the wire format, not just a helper against itself.
  const payload = JSON.stringify([
    "reelogram-admin",
    version,
    scope,
    projectId,
    environment,
    audience,
    keyId,
    method,
    path,
    time,
    nonce,
    createHash("sha256").update(body).digest("hex"),
  ]);
  return new Request("https://example.invalid" + path, {
    method,
    ...(body && method !== "GET" ? { body } : {}),
    headers: {
      "X-Admin-Version": version,
      "X-Admin-Scope": scope,
      "X-Admin-Project": projectId,
      "X-Admin-Environment": environment,
      "X-Admin-Audience": audience,
      "X-Admin-Key-Id": keyId,
      "X-Admin-Time": time,
      "X-Admin-Nonce": nonce,
      "X-Admin-Signature": createHmac("sha256", key)
        .update(payload)
        .digest("hex"),
      ...changes,
    },
  });
}

test("admin config defaults to concealed, independent, environment-specific read access", () => {
  assert.throws(() => adminConfiguration({}, now), notFound);
  assert.deepEqual(config.credentials, [{ id: "key-one", secret }]);
  for (const patch of [
    { REELOGRAM_ADMIN_SECRET: "short" },
    { REELOGRAM_ADMIN_SECRET: "a".repeat(257) },
    { REELOGRAM_ADMIN_PROJECT_ID: "../another" },
    { REELOGRAM_NEXTAUTH_SECRET: secret },
    { REELOGRAM_ADMIN_ENVIRONMENT: "" },
    { REELOGRAM_ADMIN_KEY_ID: "" },
    { REELOGRAM_ADMIN_AUDIENCE: "" },
    { REELOGRAM_ADMIN_AUDIENCE: "https://example.invalid/path" },
    { REELOGRAM_ADMIN_AUDIENCE: "http://example.invalid" },
    { REELOGRAM_ADMIN_AUDIENCE: "https://user:pass@example.invalid" },
    { REELOGRAM_ADMIN_AUDIENCE: "https://example.invalid?x=1" },
    { REELOGRAM_ADMIN_AUDIENCE: "https://example.invalid/" },
    { VERCEL_ENV: "preview" },
  ])
    assert.throws(
      () => adminConfiguration({ ...env, ...patch }, now),
      notFound,
    );
  assert.equal(
    adminConfiguration({ ...env, VERCEL_ENV: "production" }, now).environment,
    "production",
  );
  const local = {
    ...env,
    REELOGRAM_ADMIN_ENVIRONMENT: "local",
    REELOGRAM_ADMIN_AUDIENCE: "http://localhost:3000",
  };
  assert.equal(adminConfiguration(local, now).environment, "local");
  for (const VERCEL_ENV of ["production", "preview"])
    assert.throws(
      () => adminConfiguration({ ...local, VERCEL_ENV }, now),
      notFound,
    );
  assert.deepEqual(ADMIN_CAPABILITIES, [
    "accounts.read",
    "videos.read",
    "jobs.read",
  ]);
});

test("every signed identity/request field is bound; cookie/bearer and legacy signatures are denied", () => {
  const request = signed();
  const verified = verifyAdminRequest(request, "accounts", config, now);
  assert.equal(verified.keyId, "key-one");
  assert.equal(verified.nonce, request.headers.get("x-admin-nonce"));
  for (const options of [
    { key: "b".repeat(64) },
    { time: String(now / 1000 - 61) },
    { time: String(now / 1000 + 61) },
    { nonce: "invalid" },
    { path: "/api/admin/v1/videos" },
    { path: "/api/admin/v1/accounts?limit=1" },
    { projectId: "another-project" },
    { environment: "staging" },
    { audience: "https://another.invalid" },
    { keyId: "key-revoked" },
    { scope: "write" },
    { version: "1" },
    { method: "POST", body: "{}" },
    { body: "nonempty" },
    { changes: { "content-length": "1" } },
    { changes: { "transfer-encoding": "chunked" } },
  ])
    assert.throws(
      () => verifyAdminRequest(signed(options), "accounts", config, now),
      notFound,
    );
  for (const name of [
    "version",
    "scope",
    "project",
    "environment",
    "audience",
    "key-id",
    "time",
    "nonce",
    "signature",
  ]) {
    const headers = new Headers(request.headers);
    headers.set("x-admin-" + name, "tampered");
    assert.throws(
      () =>
        verifyAdminRequest(
          new Request(request.url, { headers }),
          "accounts",
          config,
          now,
        ),
      notFound,
    );
    headers.delete("x-admin-" + name);
    assert.throws(
      () =>
        verifyAdminRequest(
          new Request(request.url, { headers }),
          "accounts",
          config,
          now,
        ),
      notFound,
    );
  }
  for (const headers of [
    { Cookie: "next-auth.session-token=customer" },
    { Authorization: "Bearer " + secret },
  ])
    assert.throws(
      () =>
        verifyAdminRequest(
          new Request(request.url, { headers }),
          "accounts",
          config,
          now,
        ),
      notFound,
    );
  const legacy = new Headers(request.headers);
  legacy.set(
    "x-admin-signature",
    createHmac("sha256", secret)
      .update(
        [
          "GET",
          "/api/admin/v1/accounts",
          legacy.get("x-admin-time"),
          legacy.get("x-admin-nonce"),
          "",
        ].join("\n"),
      )
      .digest("hex"),
  );
  assert.throws(
    () =>
      verifyAdminRequest(
        new Request(request.url, { headers: legacy }),
        "accounts",
        config,
        now,
      ),
    notFound,
  );
  // Signed audience comes from configuration, never a proxy-controlled Host header.
  assert.equal(
    verifyAdminRequest(
      signed({ changes: { "x-forwarded-host": "evil.invalid" } }),
      "accounts",
      config,
      now,
    ).projectId,
    config.projectId,
  );
  for (const offset of [-60, 60])
    verifyAdminRequest(
      signed({ time: String(now / 1000 + offset) }),
      "accounts",
      config,
      now,
    );
});

test("key rotation has a bounded overlap, expiry and immediate removal/revocation", () => {
  const previous = {
    REELOGRAM_ADMIN_PREVIOUS_KEY_ID: "key-old",
    REELOGRAM_ADMIN_PREVIOUS_SECRET: "b".repeat(64),
    REELOGRAM_ADMIN_PREVIOUS_VALID_UNTIL: new Date(now + 60000)
      .toISOString()
      .replace(".000", ""),
  };
  const rotating = adminConfiguration({ ...env, ...previous }, now);
  const old = signed({
    keyId: "key-old",
    key: previous.REELOGRAM_ADMIN_PREVIOUS_SECRET,
  });
  verifyAdminRequest(old, "accounts", rotating, now);
  verifyAdminRequest(signed(), "accounts", rotating, now);
  assert.throws(
    () => verifyAdminRequest(old, "accounts", config, now),
    notFound,
  );
  assert.throws(
    () => verifyAdminRequest(old, "accounts", rotating, now + 60000),
    notFound,
  );
  assert.equal(
    adminConfiguration({ ...env, ...previous }, now + 60000).credentials.length,
    1,
  );
  for (const patch of [
    { REELOGRAM_ADMIN_PREVIOUS_KEY_ID: "key-one" },
    { REELOGRAM_ADMIN_PREVIOUS_SECRET: secret },
    { REELOGRAM_ADMIN_PREVIOUS_VALID_UNTIL: "" },
    { REELOGRAM_ADMIN_PREVIOUS_SECRET: "" },
    {
      REELOGRAM_ADMIN_PREVIOUS_VALID_UNTIL: new Date(now + 86401000)
        .toISOString()
        .replace(".000", ""),
    },
  ])
    assert.throws(
      () => adminConfiguration({ ...env, ...previous, ...patch }, now),
      notFound,
    );
  // A leaked old secret cannot sign using the new credential ID.
  assert.throws(
    () =>
      verifyAdminRequest(
        signed({ key: previous.REELOGRAM_ADMIN_PREVIOUS_SECRET }),
        "accounts",
        rotating,
        now,
      ),
    notFound,
  );
});

test("canonical signing encoder and audit records exclude credentials and private payloads", () => {
  const input = {
    projectId: config.projectId,
    environment: config.environment,
    audience: config.audience,
    keyId: "key-one",
    method: "GET",
    path: "/api/admin/v1/accounts",
    time: String(now / 1000),
    nonce: randomUUID(),
    body: "",
  };
  assert.equal(
    createHmac("sha256", secret)
      .update(adminSigningPayload(input))
      .digest("hex"),
    signed(input).headers.get("x-admin-signature"),
  );
  const lines = [];
  auditAdminAccess(
    {
      projectId: config.projectId,
      environment: config.environment,
      keyId: "key-one",
      nonce: "PRIVATE_NONCE",
    },
    "accounts",
    200,
    (line) => lines.push(line),
  );
  assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(), [
    "at",
    "credentialId",
    "environment",
    "event",
    "projectId",
    "resource",
    "status",
  ]);
  assert(!lines[0].includes(secret));
  assert(!lines[0].includes("PRIVATE_NONCE"));
});
