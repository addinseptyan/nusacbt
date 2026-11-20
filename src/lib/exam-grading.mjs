/**
 * Nilai dasar untuk satu pengerjaan, tanpa penalti. Jangan gunakan bilangan
 * pecahan yang dibulatkan sebagai sumber agregasi/riwayat: simpan jumlah benar
 * dan jumlah soal. Pembulatan hanya untuk tampilan dua angka desimal.
 *
 * @param {unknown} correct
 * @param {unknown} total
 * @returns {{ok: true, correct: number, total: number, hundredths: number, display: string} | {ok: false, error: string}}
 */
export function gradeExamCounts(correct, total) {
  if (!Number.isSafeInteger(total) || /** @type {number} */ (total) < 1 || /** @type {number} */ (total) > 1000 ||
      !Number.isSafeInteger(correct) || /** @type {number} */ (correct) < 0 || /** @type {number} */ (correct) > /** @type {number} */ (total)) {
    return { ok: false, error: "Jumlah jawaban atau soal tidak valid." };
  }
  const right = /** @type {number} */ (correct);
  const count = /** @type {number} */ (total);
  // 100 poin × 100 satuan per poin; setengah dibulatkan ke atas.
  // Seluruh operasi bilangan bulat tetap tepat untuk batas 1.000 soal.
  const hundredths = Math.floor((right * 20_000 + count) / (2 * count));
  const display = `${Math.floor(hundredths / 100)},${String(hundredths % 100).padStart(2, "0")}`;
  return { ok: true, correct: right, total: count, hundredths, display };
}
