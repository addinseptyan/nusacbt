import assert from "node:assert/strict";
import test from "node:test";

import { gradeExamCounts } from "../../src/lib/exam-grading.mjs";

test("nilai proporsional: benar semua 100, salah dan kosong tidak menambah poin", () => {
  assert.deepEqual(gradeExamCounts(10, 10), { ok: true, correct: 10, total: 10, hundredths: 10000, display: "100,00" });
  assert.deepEqual(gradeExamCounts(0, 10), { ok: true, correct: 0, total: 10, hundredths: 0, display: "0,00" });
  assert.equal(gradeExamCounts(6, 10).display, "60,00");
  // Pembilang hanya jumlah benar; salah maupun kosong tidak dikurangkan.
  assert.equal(gradeExamCounts(2, 5).display, "40,00");
});

test("tampilan membulatkan dua desimal tanpa mengubah jumlah benar dan soal", () => {
  assert.deepEqual(gradeExamCounts(1, 3), { ok: true, correct: 1, total: 3, hundredths: 3333, display: "33,33" });
  assert.equal(gradeExamCounts(2, 3).display, "66,67");
  assert.equal(gradeExamCounts(1, 6).display, "16,67");
  assert.equal(gradeExamCounts(1, 32).display, "3,13"); // 3,125 dibulatkan ke atas
  assert.equal(gradeExamCounts(999, 1000).display, "99,90");
});

test("menolak penyebut nol, nilai tidak lengkap, pecahan, dan hitungan mustahil", () => {
  for (const pair of [[0, 0], [-1, 5], [6, 5], [1, 1001], [1.5, 3], [1, 2.5], ["1", 2], [1, null], [Infinity, 3], [NaN, 3]]) {
    assert.equal(gradeExamCounts(pair[0], pair[1]).ok, false, String(pair));
  }
});

test("seluruh kombinasi hingga 1.000 soal sesuai pembulatan rasional eksak", () => {
  for (let total = 1; total <= 1000; total += 1) {
    for (let correct = 0; correct <= total; correct += 1) {
      const score = gradeExamCounts(correct, total);
      const expected = Number((BigInt(correct) * 20_000n + BigInt(total)) / (2n * BigInt(total)));
      assert.equal(score.ok && score.hundredths, expected, `${correct}/${total}`);
    }
  }
});
