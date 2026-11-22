import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateFinalGrade, formatFinalGrade } from "../../src/lib/exam-final-grade.mjs";

const attempt = (correctCount, questionCount) => ({ correctCount, questionCount });

test("nilai akhir memilih tertinggi atau rata-rata bobot sama per pengerjaan", () => {
  const history = [attempt(3, 5), attempt(4, 5)];
  assert.equal(calculateFinalGrade("highest", history), 80);
  assert.equal(calculateFinalGrade("average", history), 70);
  // Bukan jumlah jawaban benar total dibagi jumlah soal total.
  assert.equal(calculateFinalGrade("average", [attempt(1, 1), attempt(0, 9)]), 50);
  assert.equal(calculateFinalGrade("highest", [attempt(1, 3), attempt(2, 7)]), 33.33);
  assert.equal(formatFinalGrade(8.33), "8,33");
  assert.equal(formatFinalGrade(100), "100,00");
});

test("tidak merata-ratakan nilai tampilan; bulat setengah ke atas pada akhir", () => {
  assert.equal(calculateFinalGrade("average", [attempt(1, 6), attempt(0, 1)]), 8.33);
  assert.equal(calculateFinalGrade("highest", [attempt(1, 32)]), 3.13);
  assert.equal(calculateFinalGrade("average", [attempt(1, 16), attempt(0, 1)]), 3.13);
  assert.equal(calculateFinalGrade("average", [attempt(1, 1000), attempt(0, 1000)]), 0.05);
});

test("data kosong atau tidak valid tidak menghasilkan nilai", () => {
  assert.equal(calculateFinalGrade("average", []), null);
  assert.equal(calculateFinalGrade("wrong", [attempt(1, 1)]), null);
  for (const item of [attempt(-1, 3), attempt(4, 3), attempt(1, 0), attempt(1, 1001), attempt(0.5, 1), attempt(null, 1), null]) {
    assert.equal(calculateFinalGrade("highest", [item]), null);
    assert.equal(calculateFinalGrade("average", [item]), null);
  }
});

test("rasional eksak tetap stabil untuk seribu penyebut berbeda", () => {
  const items = Array.from({ length: 1000 }, (_, i) => attempt(i + 1, i + 1));
  assert.equal(calculateFinalGrade("average", items), 100);
  assert.equal(calculateFinalGrade("highest", items), 100);
});
