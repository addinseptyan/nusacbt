import assert from "node:assert/strict";
import test from "node:test";
import { EXAM_OPTION_IDS, examAnswer, examAnswerRevision, examQuestionPosition, shuffleExamItems, validExamOptionOrder } from "../../src/lib/exam-attempt-validation.mjs";

test("posisi soal dan jawaban menerima hanya identitas yang valid", () => {
  assert.equal(examQuestionPosition("1"), 1);
  assert.equal(examQuestionPosition("1000"), 1000);
  for (const value of ["0", "01", "1001", "1.5", " 1", "-1", 1, ["1"], null]) assert.equal(examQuestionPosition(value), null);
  for (const value of EXAM_OPTION_IDS) assert.equal(examAnswer(value), value);
  for (const value of ["a", "AB", "F", "", null, ["A"], 1]) assert.equal(examAnswer(value), null);
});

test("revisi jawaban menerima bigint nonnegatif dengan format kanonis", () => {
  for (const value of ["0", "1", "9223372036854775807"]) assert.equal(examAnswerRevision(value), value);
  for (const value of ["-1", "00", " 1", "1.0", "9223372036854775808", 0, null]) assert.equal(examAnswerRevision(value), null);
});

test("urutan pilihan harus permutasi A sampai E", () => {
  assert.equal(validExamOptionOrder("ABCDE"), true);
  assert.equal(validExamOptionOrder("EACBD"), true);
  for (const value of ["AABCD", "ABCDEE", "abcde", "ABCDE ", "ABCD", "ABCDF", null]) assert.equal(validExamOptionOrder(value), false);
});

test("pengacakan tidak mengubah input dan memeriksa rentang generator", () => {
  const input = [...EXAM_OPTION_IDS];
  assert.deepEqual(shuffleExamItems(input, () => 0), ["B", "C", "D", "E", "A"]);
  assert.deepEqual(input, ["A", "B", "C", "D", "E"]);
  assert.deepEqual(shuffleExamItems(["only"]), ["only"]);
  assert.throws(() => shuffleExamItems(input, (max) => max), /Generator acak/);
  assert.throws(() => shuffleExamItems(input, () => -1), /Generator acak/);
});
