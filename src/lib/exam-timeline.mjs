// Ketiga zona Indonesia yang didukung jadwal tidak memiliki DST pada rentang
// tahun rancangan yang diterima aplikasi (2000–2100).
const OFFSETS = { WIB: 7 * 60, WITA: 8 * 60, WIT: 9 * 60 };
const DAY_MINUTES = 24 * 60;

/** @param {unknown} value */
export function validTimelineDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01" || value > "2100-12-31") return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/** @param {string} date @param {number} days */
export function shiftTimelineDate(date, days) {
  if (!validTimelineDate(date) || !Number.isInteger(days) || Math.abs(days) > 7) return null;
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MINUTES * 60_000).toISOString().slice(0, 10);
  return validTimelineDate(shifted) ? shifted : null;
}

/** @param {string} instant @param {"WIB"|"WITA"|"WIT"} zone */
export function timelineLocal(instant, zone) {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms) || !(zone in OFFSETS)) return null;
  return new Date(ms + OFFSETS[zone] * 60_000).toISOString().slice(0, 16);
}

/**
 * Kembalikan segmen terpotong dalam menit dari awal rentang, atau null jika
 * tidak beririsan. Akhir eksklusif: tes berakhir tepat pukul 00 bukan tes hari berikutnya.
 * @param {string} instant @param {number} durationMinutes @param {string} date
 * @param {"WIB"|"WITA"|"WIT"} zone @param {number} [days]
 */
export function timelineSegment(instant, durationMinutes, date, zone, days = 7) {
  if (!validTimelineDate(date) || !(zone in OFFSETS) || !Number.isFinite(durationMinutes) || durationMinutes <= 0 || !Number.isInteger(days) || days < 1 || days > 7) return null;
  const start = Date.parse(instant);
  if (!Number.isFinite(start)) return null;
  const relativeStart = (start + OFFSETS[zone] * 60_000 - Date.parse(`${date}T00:00:00Z`)) / 60_000;
  const relativeEnd = relativeStart + durationMinutes;
  const total = days * DAY_MINUTES;
  if (relativeEnd <= 0 || relativeStart >= total) return null;
  const left = Math.max(0, relativeStart);
  const right = Math.min(total, relativeEnd);
  return { left, width: right - left, clippedStart: relativeStart < 0, clippedEnd: relativeEnd > total };
}
