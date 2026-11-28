import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionCookieOptions } from "../../src/lib/session-cookie.mjs";

test("opsi cookie default memakai SameSite=strict dan mengikuti NODE_ENV atau NUSACBT_COOKIE_SECURE", () => {
  assert.deepEqual(buildSessionCookieOptions("/", 3600, { NODE_ENV: "production" }), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 3600,
  });
  assert.deepEqual(buildSessionCookieOptions("/peserta", 60, { NODE_ENV: "production", NUSACBT_COOKIE_SECURE: "false" }), {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    path: "/peserta",
    maxAge: 60,
  });
});

test("opsi cookie iframe preview mendukung SameSite=none + Partitioned ketika Secure=true dan menolak konfigurasi tak aman", () => {
  assert.deepEqual(
    buildSessionCookieOptions("/", 3600, {
      NODE_ENV: "production",
      NUSACBT_COOKIE_SECURE: "true",
      NUSACBT_COOKIE_SAMESITE: "none",
      NUSACBT_COOKIE_PARTITIONED: "true",
    }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 3600,
      partitioned: true,
    },
  );
  assert.throws(() => buildSessionCookieOptions("/", 60, { NUSACBT_COOKIE_SECURE: "false", NUSACBT_COOKIE_SAMESITE: "none" }));
  assert.throws(() => buildSessionCookieOptions("/", 60, { NUSACBT_COOKIE_SECURE: "false", NUSACBT_COOKIE_PARTITIONED: "true" }));
  assert.throws(() => buildSessionCookieOptions("/", 60, { NUSACBT_COOKIE_SECURE: "true", NUSACBT_COOKIE_SAMESITE: "invalid" }));
});
