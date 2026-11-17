import assert from "node:assert/strict";
import test from "node:test";

import { validDataId, validateClassLevel, validateMajorName } from "../../src/lib/class-validation.mjs";

test("nama jurusan wajib, dibersihkan, dan dibatasi 60 karakter tanpa karakter kontrol", () => {
  assert.deepEqual(validateMajorName("  AK  "), { ok: true, value: "AK" });
  assert.equal(validateMajorName("x".repeat(60)).ok, true);
  assert.equal(validateMajorName("x".repeat(61)).ok, false);
  assert.equal(validateMajorName("   ").ok, false);
  assert.equal(validateMajorName("A\nK").ok, false);
  assert.equal(validateMajorName("A\u0000K").ok, false);
  assert.equal(validateMajorName(null).ok, false);
});

test("tingkat kelas berupa huruf atau angka dan disimpan sebagai huruf besar", () => {
  assert.deepEqual(validateClassLevel("  xi  "), { ok: true, value: "XI" });
  assert.deepEqual(validateClassLevel("12"), { ok: true, value: "12" });
  for (const value of ["", " ", "X AK", "X-1", "x".repeat(13), "X\nI", null, 1]) {
    assert.equal(validateClassLevel(value).ok, false);
  }
});

test("ID kelas dan jurusan hanya menerima bigint positif yang valid", () => {
  assert.equal(validDataId("1"), "1");
  assert.equal(validDataId("9223372036854775807"), "9223372036854775807");
  for (const value of ["0", "-1", "01", "1; DELETE", "9223372036854775808", "", null, 1]) {
    assert.equal(validDataId(value), null);
  }
});
