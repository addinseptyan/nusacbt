import assert from "node:assert/strict";
import test from "node:test";

import { validateQuestionContent, validateQuestionDraft } from "../../src/lib/question-validation.mjs";

function draft(overrides = {}) {
  return { topicId: "42", prompt: "  Pertanyaan\r\nbaris kedua  ", options: ["  satu  ", "dua", "tiga", "empat", "lima"], correctOption: "B", ...overrides };
}

test("soal memiliki satu kategori, lima pilihan, dan satu kunci; teks dibersihkan", () => {
  const result = validateQuestionDraft(draft());
  assert.deepEqual(result, { ok: true, value: { topicId: "42", prompt: "Pertanyaan\nbaris kedua", options: ["satu", "dua", "tiga", "empat", "lima"], correctOption: "B" } });
  for (const correctOption of ["A", "B", "C", "D", "E"]) assert.equal(validateQuestionDraft(draft({ correctOption })).ok, true);
  const unicode = validateQuestionDraft(draft({ prompt: "😀".repeat(5000), options: ["é".repeat(2000), "b", "c", "d", "e"] }));
  assert.equal(unicode.ok, true);
});

test("kategori, tepat lima pilihan, dan tepat satu kunci divalidasi di server", () => {
  for (const topicId of [null, "", "0", "01", "-1", "9223372036854775808", 3]) assert.equal(validateQuestionDraft(draft({ topicId })).ok, false);
  for (const options of [null, [], ["a", "b", "c", "d"], ["a", "b", "c", "d", "e", "f"], ["a", "b", null, "d", "e"]]) assert.equal(validateQuestionDraft(draft({ options })).ok, false);
  for (const correctOption of [null, "", "a", "F", "AB", ["A", "B"], 1]) assert.equal(validateQuestionDraft(draft({ correctOption })).ok, false);
});

test("teks dibatasi berdasarkan karakter Unicode dan menolak karakter kontrol serta Unicode rusak", () => {
  for (const prompt of [null, "x".repeat(5001), "😀".repeat(5001), "bad\u0000", "bad\u000b ", "\u0085bad", "bad\ud800"]) assert.equal(validateQuestionDraft(draft({ prompt })).ok, false);
  assert.equal(validateQuestionDraft(draft({ options: ["x".repeat(2001), "b", "c", "d", "e"] })).ok, false);
  assert.equal(validateQuestionDraft(draft({ prompt: "tab\tdan\nbaris" })).ok, true);
});

test("soal dan setiap pilihan wajib memiliki teks atau gambar efektif", () => {
  const content = { prompt: "", options: ["", "B", "C", "D", "E"] };
  assert.equal(validateQuestionContent(content, [false, true, false, false, false, false]).ok, false);
  assert.equal(validateQuestionContent(content, [true, false, false, false, false, false]).ok, false);
  assert.deepEqual(validateQuestionContent(content, [true, true, false, false, false, false]), { ok: true });
  assert.equal(validateQuestionContent(content, [true]).ok, false);
});
