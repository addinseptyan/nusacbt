/** @param {unknown} value @returns {boolean} */
export function isValidCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * @param {{name: unknown, startDate: unknown, endDate: unknown}} input
 * @returns {{ok: true, value: {name: string, startDate: string, endDate: string | null}} | {ok: false, error: string}}
 */
export function validatePeriodInput(input) {
  if (typeof input.name !== "string") return { ok: false, error: "Nama periode wajib diisi." };
  const name = input.name.trim();
  if (!name || Array.from(name).length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, error: "Nama periode wajib diisi, maksimal 100 karakter, tanpa karakter kontrol." };
  }
  if (typeof input.startDate !== "string" || !isValidCalendarDate(input.startDate)) {
    return { ok: false, error: "Tanggal mulai wajib berupa tanggal yang valid." };
  }
  const end = input.endDate === null || input.endDate === "" ? null : input.endDate;
  if (end !== null && (typeof end !== "string" || !isValidCalendarDate(end))) {
    return { ok: false, error: "Tanggal akhir harus berupa tanggal yang valid." };
  }
  if (end !== null && end < input.startDate) {
    return { ok: false, error: "Tanggal akhir tidak boleh lebih awal dari tanggal mulai." };
  }
  return { ok: true, value: { name, startDate: input.startDate, endDate: end } };
}

/** @param {unknown} value @returns {string | null} */
export function validPeriodId(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/.test(value)) return null;
  if (BigInt(value) > BigInt("9223372036854775807")) return null;
  return value;
}
