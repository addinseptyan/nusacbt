import assert from "node:assert/strict";
import test from "node:test";

import { validateNisn, validateStudentInput, validateStudentName } from "../../src/lib/student-validation.mjs";

test("nama siswa wajib, dibersihkan, dan dibatasi 100 karakter tanpa karakter kontrol", () => {
  assert.deepEqual(validateStudentName("  Siswa Contoh  "), { ok: true, value: "Siswa Contoh" });
  assert.equal(validateStudentName("x".repeat(100)).ok, true);
  assert.equal(validateStudentName("x".repeat(101)).ok, false);
  for (const value of ["", "   ", "A\nB", "A\u0000B", null, 123]) {
    assert.equal(validateStudentName(value).ok, false);
  }
});

test("NISN wajib tepat sepuluh digit dan tetap berbentuk teks dengan nol di depan", () => {
  assert.deepEqual(validateNisn("  0000000001  "), { ok: true, value: "0000000001" });
  assert.deepEqual(validateNisn("1234567890"), { ok: true, value: "1234567890" });
  for (const value of ["", "123456789", "12345678901", "12345 7890", "12345a7890", "１２３４５６７８９０", null, 1234567890]) {
    assert.equal(validateNisn(value).ok, false);
  }
});

test("validasi siswa mengembalikan nilai yang sudah dibersihkan", () => {
  assert.deepEqual(validateStudentInput({ name: "  Contoh Siswa A  ", nisn: " 0000000001 " }), {
    ok: true,
    value: { name: "Contoh Siswa A", nisn: "0000000001" },
  });
  assert.equal(validateStudentInput({ name: "", nisn: "0000000001" }).ok, false);
  assert.equal(validateStudentInput({ name: "Contoh", nisn: "1" }).ok, false);
});
