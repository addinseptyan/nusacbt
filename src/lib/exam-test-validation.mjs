import { validDataId } from "./class-validation.mjs";
import { validateTagList, validTopicRevision } from "./topic-validation.mjs";

export const EXAM_TEST_MAX_QUESTIONS = 1000;
export const EXAM_TEST_MAX_DURATION = 10080;
export const EXAM_TEST_FORM_VERSION = "draft-v1";
const zoneMinutes = Object.freeze({ WIB: 420, WITA: 480, WIT: 540 });

/**
 * The three supported school time zones are explicit fixed UTC offsets, not
 * the Node server/browser local zone. Reject invalid calendar dates instead
 * of allowing Date.UTC to normalize them silently.
 * @param {unknown} local @param {unknown} zone
 * @returns {{ok: true, value: {local: string, zone: "WIB" | "WITA" | "WIT", startsAt: string}} | {ok: false, error: string}}
 */
export function validateExamStart(local, zone) {
  if (typeof zone !== "string" || !Object.hasOwn(zoneMinutes, zone)) return { ok: false, error: "Pilih zona waktu WIB, WITA, atau WIT." };
  if (typeof local !== "string") return { ok: false, error: "Tanggal dan waktu mulai wajib diisi." };
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return { ok: false, error: "Tanggal dan waktu mulai tidak valid." };
  const [, y, m, d, hh, mm] = match;
  const year = Number(y), month = Number(m), day = Number(d), hour = Number(hh), minute = Number(mm);
  if (year < 2000 || year > 2100) return { ok: false, error: "Tahun jadwal harus antara 2000 dan 2100." };
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day || wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute) {
    return { ok: false, error: "Tanggal dan waktu mulai tidak valid." };
  }
  const safeZone = /** @type {"WIB" | "WITA" | "WIT"} */ (zone);
  return { ok: true, value: { local, zone: safeZone, startsAt: new Date(wall.getTime() - zoneMinutes[safeZone] * 60000).toISOString() } };
}

/**
 * Validasi daftar tag rancangan tes (maksimal 10 tag unik, diurutkan alfabetis).
 * @param {unknown} value
 * @returns {{ok: true, value: string[], signature: string} | {ok: false, error: string}}
 */
export function validateExamTestTags(value) {
  return validateTagList(value, "rancangan tes");
}

/**
 * Peringatan non-blocking apabila tanggal jadwal lokal di luar rentang periode ujian.
 * @param {string} startLocal
 * @param {string | null} endLocal
 * @param {string | null | undefined} periodStartDate
 * @param {string | null | undefined} periodEndDate
 * @returns {string | null}
 */
export function checkExamDateAgainstPeriod(startLocal, endLocal, periodStartDate, periodEndDate) {
  if (!periodStartDate || !/^\d{4}-\d{2}-\d{2}/.test(startLocal)) return null;
  const startDate = startLocal.slice(0, 10);
  const endDate = endLocal && /^\d{4}-\d{2}-\d{2}/.test(endLocal) ? endLocal.slice(0, 10) : startDate;
  if (startDate < periodStartDate) {
    return `Tanggal mulai (${startDate}) lebih awal dari tanggal mulai periode (${periodStartDate}). Jadwal tetap dapat disimpan bila disengaja.`;
  }
  if (periodEndDate && endDate > periodEndDate) {
    return `Tanggal selesai (${endDate}) melewati tanggal selesai periode (${periodEndDate}). Jadwal tetap dapat disimpan bila disengaja.`;
  }
  if (periodEndDate && startDate > periodEndDate) {
    return `Tanggal mulai (${startDate}) melewati tanggal selesai periode (${periodEndDate}). Jadwal tetap dapat disimpan bila disengaja.`;
  }
  return null;
}

/**
 * @param {{name: unknown, periodId: unknown, startLocal: unknown, timeZone: unknown, durationMinutes: unknown, shuffleQuestions: unknown, shuffleOptions: unknown, questionIds: unknown, questionRevisions: unknown}} input
 * @returns {{ok: true, value: {name: string, periodId: string, startsAt: string, timeZone: "WIB" | "WITA" | "WIT", durationMinutes: number, shuffleQuestions: boolean, shuffleOptions: boolean, questionIds: string[], questionRevisions: string[]}} | {ok: false, error: string}}
 */
export function validateExamTestDraft(input) {
  if (typeof input.name !== "string" || input.name.length > 1024 || !input.name.isWellFormed() || /[\u0000-\u001f\u007f-\u009f]/.test(input.name)) return { ok: false, error: "Nama tes wajib diisi, maksimal 100 karakter, tanpa karakter kontrol." };
  const name = input.name.trim();
  if (!name || Array.from(name).length > 100) return { ok: false, error: "Nama tes wajib diisi, maksimal 100 karakter, tanpa karakter kontrol." };
  const periodId = validDataId(input.periodId);
  if (!periodId) return { ok: false, error: "Pilih periode ujian yang valid." };
  const schedule = validateExamStart(input.startLocal, input.timeZone);
  if (!schedule.ok) return schedule;
  if (typeof input.durationMinutes !== "string" || !/^[1-9]\d{0,4}$/.test(input.durationMinutes)) return { ok: false, error: "Durasi harus berupa jumlah menit bulat antara 1 dan 10080." };
  const durationMinutes = Number(input.durationMinutes);
  if (durationMinutes > EXAM_TEST_MAX_DURATION) return { ok: false, error: "Durasi harus berupa jumlah menit bulat antara 1 dan 10080." };
  if (![null, "1"].includes(/** @type {null | string} */ (input.shuffleQuestions)) || ![null, "1"].includes(/** @type {null | string} */ (input.shuffleOptions))) return { ok: false, error: "Pengaturan acak tidak valid." };
  if (!Array.isArray(input.questionIds) || input.questionIds.length > EXAM_TEST_MAX_QUESTIONS) return { ok: false, error: "Pilih maksimal 1000 soal untuk satu tes." };
  if (!Array.isArray(input.questionRevisions) || input.questionRevisions.length !== input.questionIds.length) return { ok: false, error: "Versi soal tidak lengkap. Muat ulang daftar." };
  const questionIds = [];
  const questionRevisions = [];
  const seen = new Set();
  for (const [index, item] of input.questionIds.entries()) {
    const id = validDataId(item);
    const revision = validTopicRevision(input.questionRevisions[index]);
    if (!id || !revision || seen.has(id)) return { ok: false, error: "Daftar soal tidak valid, sudah usang, atau mengandung soal ganda. Muat ulang daftar." };
    seen.add(id); questionIds.push(id); questionRevisions.push(revision);
  }
  return { ok: true, value: { name, periodId, startsAt: schedule.value.startsAt, timeZone: schedule.value.zone, durationMinutes, shuffleQuestions: input.shuffleQuestions === "1", shuffleOptions: input.shuffleOptions === "1", questionIds, questionRevisions } };
}
