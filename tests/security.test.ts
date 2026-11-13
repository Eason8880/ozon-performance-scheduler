import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

process.env.SESSION_SECRET = "test-session-secret-with-more-than-32-chars";
process.env.ADMIN_PASSWORD = "global-admin-test-password";
for (const key of [
  "OZ1_ADMIN_PASSWORD",
  "OZ2_ADMIN_PASSWORD",
  "OZ3_ADMIN_PASSWORD",
  "OZ4_ADMIN_PASSWORD",
  "OZ5_ADMIN_PASSWORD",
])
  delete process.env[key];

const {
  checkPassword,
  sessionGroupFromCookie,
} = require("../src/lib/security");

function cookie(payload: string) {
  const signature = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

test("defaults map oz1 through oz5 to distinct groups", () => {
  for (const group of ["oz1", "oz2", "oz3", "oz4", "oz5"] as const)
    assert.equal(checkPassword(group), group);
  assert.equal(checkPassword("not-a-valid-password"), null);
});

test("duplicate configured passwords are rejected", () => {
  process.env.OZ1_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  assert.equal(checkPassword("global-admin-test-password"), null);
  process.env.OZ1_ADMIN_PASSWORD = "oz2";
  assert.equal(checkPassword("oz2"), null);
  delete process.env.OZ1_ADMIN_PASSWORD;
});

test("accepts signed group sessions and rejects tampering or expiry", () => {
  const expiry = Date.now() + 60_000;
  for (const group of ["admin", "oz1", "oz2", "oz3", "oz4", "oz5"])
    assert.equal(sessionGroupFromCookie(cookie(`${expiry}.${group}`)), group);

  const valid = cookie(`${expiry}.oz1`);
  assert.equal(sessionGroupFromCookie(`${valid.slice(0, -1)}x`), null);
  assert.equal(sessionGroupFromCookie(cookie(`${Date.now() - 1}.oz1`)), null);
});

test("keeps valid legacy expiry-only session as global admin", () => {
  assert.equal(
    sessionGroupFromCookie(cookie(`${Date.now() + 60_000}`)),
    "admin",
  );
});

test("rejects a JSON null login body with 401", async () => {
  const { POST } = require("../src/app/api/login/route");
  const response = await POST(
    new Request("http://local.test/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    }),
  );
  assert.equal(response.status, 401);
});
