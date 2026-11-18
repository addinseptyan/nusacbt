import { validDataId } from "./class-validation.mjs";

const LETTERS = ["A", "B", "C", "D", "E"];

/**
 * Isi disimpan sebagai teks biasa; line break dan tab diperbolehkan.
 * @param {unknown} value
 * @param {number} limit
 * @param {string} label
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
function cleanText(value, limit, label) {
  if (typeof value !== "string" || value.length > limit * 4 + 1024 || !value.isWellFormed()) {
    return { ok: false, error: `${label} tidak valid atau terlalu panjang.` };
  }
  const normalized = value.replace(/\r\n?/g, "\n");
  const text = normalized.trim();
  if (Array.from(text).length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(normalized)) {
    return { ok: false, error: `${label} maksimal ${limit} karakter dan tidak boleh mengandung karakter kontrol.` };
  }
  return { ok: true, value: text };
}

/**
 * @param {{topicId: unknown, prompt: unknown, options: unknown, correctOption: unknown}} input
 * @returns {{ok: true, value: {topicId: string, prompt: string, options: string[], correctOption: string}} | {ok: false, error: string}}
 */
export function validateQuestionDraft(input) {
  const topicId = validDataId(input.topicId);
  if (!topicId) return { ok: false, error: "Pilih satu topik atau mata pelajaran yang valid." };
  const prompt = cleanText(input.prompt, 5000, "Isi soal");
  if (!prompt.ok) return prompt;
  if (!Array.isArray(input.options) || input.options.length !== 5) return { ok: false, error: "Lima pilihan A sampai E wajib disediakan." };
  /** @type {string[]} */
  const options = [];
  for (const [index, value] of input.options.entries()) {
    const text = cleanText(value, 2000, `Pilihan ${LETTERS[index]}`);
    if (!text.ok) return text;
    options.push(text.value);
  }
  if (typeof input.correctOption !== "string" || !LETTERS.includes(input.correctOption)) {
    return { ok: false, error: "Pilih tepat satu jawaban benar dari A sampai E." };
  }
  return { ok: true, value: { topicId, prompt: prompt.value, options, correctOption: input.correctOption } };
}

/**
 * Memeriksa isi efektif setelah gambar lama, penghapusan, dan file baru digabungkan.
 * @param {{prompt: string, options: string[]}} draft
 * @param {boolean[]} hasImages Urutan: soal, A, B, C, D, E.
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateQuestionContent(draft, hasImages) {
  if (!Array.isArray(hasImages) || hasImages.length !== 6 || draft.options.length !== 5) {
    return { ok: false, error: "Data soal tidak lengkap. Muat ulang daftar." };
  }
  if (!draft.prompt && !hasImages[0]) return { ok: false, error: "Isi soal harus berisi teks atau gambar." };
  for (let index = 0; index < LETTERS.length; index += 1) {
    if (!draft.options[index] && !hasImages[index + 1]) return { ok: false, error: `Pilihan ${LETTERS[index]} harus berisi teks atau gambar.` };
  }
  return { ok: true };
}
