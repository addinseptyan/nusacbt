import assert from "node:assert/strict";
import test from "node:test";

import { isValidCalendarDate, validPeriodId, validatePeriodInput } from "../../src/lib/period-validation.mjs";

test("tanggal kalender divalidasi tanpa pergeseran zona waktu", () => {
  assert.equal(isValidCalendarDate("2024-02-29"), true);
  assert.equal(isValidCalendarDate("2023-02-29"), false);
  assert.equal(isValidCalendarDate("2026-04-31"), false);
  assert.equal(isValidCalendarDate("2026-4-01"), false);
  assert.equal(isValidCalendarDate("0000-01-01"), false);
  assert.equal(isValidCalendarDate("9999-12-31"), true);
});

test("nama dan tanggal periode tervalidasi, akhir bersifat opsional", () => {
  assert.deepEqual(validatePeriodInput({ name: "  Ujian Ganjil  ", startDate: "2026-07-01", endDate: "" }), {
    ok: true, value: { name: "Ujian Ganjil", startDate: "2026-07-01", endDate: null },
  });
  assert.equal(validatePeriodInput({ name: "Ujian", startDate: "2026-07-01", endDate: "2026-07-01" }).ok, true);
  assert.equal(validatePeriodInput({ name: " ", startDate: "2026-07-01", endDate: null }).ok, false);
  assert.equal(validatePeriodInput({ name: "x".repeat(101), startDate: "2026-07-01", endDate: "" }).ok, false);
  assert.equal(validatePeriodInput({ name: "A\nB", startDate: "2026-07-01", endDate: "" }).ok, false);
  assert.equal(validatePeriodInput({ name: "Ujian", startDate: "2026-02-30", endDate: "" }).ok, false);
  assert.equal(validatePeriodInput({ name: "Ujian", startDate: "2026-07-01", endDate: "2026-06-30" }).ok, false);
  assert.equal(validatePeriodInput({ name: "Ujian", startDate: "2026-07-01", endDate: "2026-13-01" }).ok, false);
});

test("ID periode hanya menerima bigint positif yang valid", () => {
  assert.equal(validPeriodId("1"), "1");
  assert.equal(validPeriodId("9223372036854775807"), "9223372036854775807");
  for (const value of ["0", "-1", "01", "1; DELETE", "9223372036854775808", "", null, 1]) {
    assert.equal(validPeriodId(value), null);
  }
});
