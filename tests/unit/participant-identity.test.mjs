import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_IDENTITY_PATTERN,
  planAutomaticIdentities,
  validateIdentityPattern,
  validateIdentityPrefix,
  validateParticipantNumber,
  validateParticipantUsername,
} from "../../src/lib/participant-identity-validation.mjs";

const pickFirst = () => 0;
const base = {
  count: 3,
  prefix: "CBT",
  numberPattern: DEFAULT_IDENTITY_PATTERN,
  usernamePattern: DEFAULT_IDENTITY_PATTERN,
  startDate: "2026-07-01",
  usedNumbers: [],
  usedUsernames: [],
};

test("nomor dan username manual tetap berupa teks, divalidasi, dan dapat berbeda", () => {
  assert.deepEqual(validateParticipantNumber("  000123  "), { ok: true, value: "000123" });
  assert.deepEqual(validateParticipantUsername(" Siswa_01 "), { ok: true, value: "Siswa_01" });
  for (const value of ["", "_123", "Ada spasi", "nilai\nbaru", "x".repeat(65), "É001", 123]) {
    assert.equal(validateParticipantNumber(value).ok, false);
  }
  for (const value of ["ab", ".user", "nama@sekolah", "øuser", "x".repeat(65), null]) {
    assert.equal(validateParticipantUsername(value).ok, false);
  }
  assert.equal(validateParticipantUsername("Ab-9").ok, true);
});

test("pola dibatasi placeholder aman dan tanggal berasal dari periode", () => {
  assert.deepEqual(validateIdentityPrefix(" AK- "), { ok: true, value: "AK-" });
  assert.equal(validateIdentityPrefix("a b").ok, false);
  assert.equal(validateIdentityPrefix("a".repeat(25)).ok, false);
  assert.deepEqual(validateIdentityPattern(DEFAULT_IDENTITY_PATTERN, "AK", "2026-07-01", "Nomor peserta"), {
    ok: true, value: DEFAULT_IDENTITY_PATTERN, sample: "AK202607000",
  });
  assert.deepEqual(validateIdentityPattern("{YYYYMM}-{prefix}{acak3}", "AK", "2026-07-01", "Username"), {
    ok: true, value: "{YYYYMM}-{prefix}{acak3}", sample: "202607-AK000",
  });
  for (const pattern of ["{acak3}{acak3}", "{prefix}{YYYYMM}", "{acak3}{sandi}", "{prefix}{prefix}{acak3}", "{acak3} {YYYYMM}", "-{acak3}"]) {
    assert.equal(validateIdentityPattern(pattern, "AK", "2026-07-01", "Username").ok, false);
  }
  assert.equal(validateIdentityPattern("{acak3}", "", "2026-02-30", "Username").ok, false);
});

test("pembuatan otomatis menghindari seluruh benturan dan mempertahankan nomor sama dengan username pada pola sama", () => {
  const result = planAutomaticIdentities({
    ...base, count: 998, usedNumbers: ["cbt202607001"], usedUsernames: ["CBT202607002"],
  }, pickFirst);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.length, 998);
  assert.equal(new Set(result.values.map((value) => value.number.toLowerCase())).size, 998);
  assert.ok(result.values.every((value) => value.number === value.username && /^CBT202607\d{3}$/.test(value.number)));
  assert.ok(!result.values.some((value) => ["cbt202607001", "cbt202607002"].includes(value.number.toLowerCase())));
  assert.equal(planAutomaticIdentities({ ...base, count: 999, usedNumbers: ["CBT202607001"], usedUsernames: ["cbt202607002"] }, pickFirst).ok, false);
});

test("pola nomor dan username yang berbeda menghasilkan identitas berbeda tanpa tabrakan masing-masing", () => {
  const result = planAutomaticIdentities({
    ...base,
    numberPattern: "N{YYYYMM}{acak3}",
    usernamePattern: "U{YYYYMM}{acak3}",
    usedNumbers: ["n202607999"],
    usedUsernames: ["u202607998"],
  }, pickFirst);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.length, 3);
  assert.ok(result.values.every((value) => /^N202607\d{3}$/.test(value.number) && /^U202607\d{3}$/.test(value.username)));
  assert.ok(result.values.every((value) => value.number !== value.username));
  assert.ok(!result.values.some((value) => value.number.toLowerCase() === "n202607999" || value.username.toLowerCase() === "u202607998"));
});

test("ruang tiga angka maksimal seribu dan tidak mengulang tanpa batas", () => {
  const full = planAutomaticIdentities({ ...base, count: 1000 }, pickFirst);
  assert.equal(full.ok, true);
  if (!full.ok) return;
  assert.equal(new Set(full.values.map((value) => value.number)).size, 1000);
  const exhausted = planAutomaticIdentities({ ...base, count: 1, usedNumbers: full.values.map((value) => value.number) }, pickFirst);
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) assert.match(exhausted.error, /tidak cukup/);
  assert.equal(planAutomaticIdentities({ ...base, count: 1001 }, pickFirst).ok, false);
});
