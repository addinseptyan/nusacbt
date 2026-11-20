import { randomInt } from "node:crypto";

export const EXAM_OPTION_IDS = Object.freeze(["A", "B", "C", "D", "E"]);

/** @param {unknown} value @returns {number | null} */
export function examQuestionPosition(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,3}$/.test(value)) return null;
  const number = Number(value);
  return number <= 1000 ? number : null;
}

/** @param {unknown} value @returns {string | null} */
export function examAnswerRevision(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,18})$/.test(value)) return null;
  return BigInt(value) <= 9223372036854775807n ? value : null;
}

/** @param {unknown} value @returns {string | null} */
export function examAnswer(value) {
  return typeof value === "string" && EXAM_OPTION_IDS.includes(value) ? value : null;
}

/** @param {unknown} value @returns {boolean} */
export function validExamOptionOrder(value) {
  return typeof value === "string" && /^[ABCDE]{5}$/.test(value) && new Set(value).size === 5;
}

/**
 * Fisher–Yates menggunakan randomInt kriptografis tanpa bias. Salinan baru
 * dikembalikan; urutan yang terpilih harus disimpan sebagai snapshot attempt.
 * @template T
 * @param {readonly T[]} values
 * @param {(max: number) => number} [draw]
 * @returns {T[]}
 */
export function shuffleExamItems(values, draw = randomInt) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = draw(index + 1);
    if (!Number.isInteger(target) || target < 0 || target > index) throw new Error("Generator acak tidak valid.");
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
