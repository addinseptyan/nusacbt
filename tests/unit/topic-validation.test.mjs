import assert from "node:assert/strict";
import test from "node:test";

import { matchesMultiKeyword, validTopicRevision, validateTopicName, validateTopicTags } from "../../src/lib/topic-validation.mjs";

test("nama topik satu tingkat dibersihkan dan menerima Unicode hingga 100 karakter", () => {
  for (const [input, expected] of [
    ["  Matematika  ", "Matematika"],
    ["Bahasa Indonesia", "Bahasa Indonesia"],
    ["Aljabar  Dasar", "Aljabar  Dasar"],
    ["\u00a0Geografi\u00a0", "Geografi"],
    ["😀".repeat(100), "😀".repeat(100)],
    ["a".repeat(100), "a".repeat(100)],
  ]) assert.deepEqual(validateTopicName(input), { ok: true, value: expected });
});

test("nama topik kosong, terlalu panjang, karakter kontrol, dan Unicode rusak ditolak", () => {
  for (const input of [null, undefined, 123, {}, "", "   ", "\u00a0", "a".repeat(101), "😀".repeat(101), "a".repeat(1025), "Matematika\n", "Kimia\tDasar", "ABC\u007f", "ABC\u0085", "ABC\ud800"]) {
    assert.equal(validateTopicName(input).ok, false, `Seharusnya ditolak: ${String(input)}`);
  }
});

test("revisi baris hanya menerima bilangan XID PostgreSQL yang valid", () => {
  for (const value of ["1", "42", "4294967295"]) assert.equal(validTopicRevision(value), value);
  for (const value of [null, undefined, 42, "", "0", "01", "-1", "+1", "1.0", "1 ", "4294967296", "9".repeat(50)]) {
    assert.equal(validTopicRevision(value), null);
  }
});

test("tag mata pelajaran dibersihkan, dedup case-insensitive, diurutkan alfabetis, dan menghasilkan signature terurut", () => {
  const empty = validateTopicTags("");
  assert.deepEqual(empty, { ok: true, value: [], signature: "" });

  const parsed = validateTopicTags(["  Kelas X  ", "kelas x", " Semester 1", "Matematika"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value, ["Kelas X", "Matematika", "Semester 1"]);
    assert.equal(parsed.signature, "kelas x\x1fmatematika\x1fsemester 1");
  }

  const fromCsv = validateTopicTags("Zebra,  apel , Anggur, apel ");
  assert.equal(fromCsv.ok, true);
  if (fromCsv.ok) {
    assert.deepEqual(fromCsv.value, ["Anggur", "apel", "Zebra"]);
    assert.equal(fromCsv.signature, "anggur\x1fapel\x1fzebra");
  }

  assert.equal(validateTopicTags(["x".repeat(31)]).ok, false);
  assert.equal(validateTopicTags(Array.from({ length: 11 }, (_, i) => `tag-${i}`)).ok, false);
  assert.equal(validateTopicTags(["ok\n"]).ok, false);
});

test("pencarian multi-kata tidak terurut mencocokkan nama dan tag sekaligus", () => {
  assert.equal(matchesMultiKeyword("matematika kelas x", ["Matematika", "Kelas X", "Ganjil"]), true);
  assert.equal(matchesMultiKeyword("kelas x matematika", ["Matematika", "Kelas X", "Ganjil"]), true);
  assert.equal(matchesMultiKeyword("ganjil x", ["Matematika", "Kelas X", "Ganjil"]), true);
  assert.equal(matchesMultiKeyword("fisika kelas x", ["Matematika", "Kelas X", "Ganjil"]), false);
  assert.equal(matchesMultiKeyword("   ", ["Matematika"]), true);
});
