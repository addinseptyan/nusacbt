import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAdminUsername } from "../../src/lib/admin-username.mjs";
import { hashPassword, validNewAdminPassword, verifyPassword } from "../../src/lib/password.mjs";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";

test("hash admin menggunakan salt acak dan hanya menerima kata sandi yang benar", async () => {
  const password = "Sandi-uji-fiktif-42";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$32768\$8\$3\$/);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("salah", first), false);
  assert.equal(await verifyPassword(password, "scrypt$999999$8$1$salt$hash"), false);
  assert.equal(await verifyPassword(password, first.slice(0, -1)), false);
  assert.equal(await verifyPassword("x".repeat(513), first), false);
});

test("validasi kata sandi dan username admin", async () => {
  assert.equal(validNewAdminPassword("terlalu"), false);
  assert.equal(validNewAdminPassword("x".repeat(129)), false);
  assert.equal(validNewAdminPassword("cukup-panjang"), true);
  await assert.rejects(hashPassword("pendek"));
  assert.equal(normalizeAdminUsername("  Admin.Tes  "), "admin.tes");
  assert.equal(normalizeAdminUsername("ab"), null);
  assert.equal(normalizeAdminUsername("admin' OR 1=1"), null);
});

test("konfigurasi PostgreSQL harus eksplisit dan port valid", () => {
  const keys = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, { PGHOST: "127.0.0.1", PGPORT: "5432", PGDATABASE: "nusacbt_test", PGUSER: "test", PGPASSWORD: "test-only" });
    assert.equal(postgresConfig().port, 5432);
    process.env.PGPORT = "65536";
    assert.throws(() => postgresConfig(), /PGPORT/);
    process.env.PGPORT = "5432";
    delete process.env.PGPASSWORD;
    assert.throws(() => postgresConfig(), /belum lengkap/);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
