import { isValidCalendarDate } from "./period-validation.mjs";

/** @typedef {"WIB" | "WITA" | "WIT"} TokenZone */
export const TOKEN_ZONE_OFFSETS = Object.freeze({ WIB: 7, WITA: 8, WIT: 9 });

/** @param {unknown} value @returns {TokenZone} */
export function parseTokenZone(value) {
  return value === "WITA" || value === "WIT" ? value : "WIB";
}

/** @param {Date | string} instant @param {TokenZone} zone @returns {string} */
export function tokenCalendarDate(instant, zone) {
  const time = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  if (!Number.isFinite(time) || !Object.hasOwn(TOKEN_ZONE_OFFSETS, zone)) throw new Error("Waktu atau zona token tidak valid.");
  return new Date(time + TOKEN_ZONE_OFFSETS[zone] * 3_600_000).toISOString().slice(0, 10);
}

/** @param {unknown} date @returns {date is string} */
function supportedDate(date) {
  return typeof date === "string" && isValidCalendarDate(date) && date >= "2000-01-01" && date <= "2101-12-31";
}

/** @param {unknown} value @param {Date | string} now @param {TokenZone} zone
 * @returns {{mode: "today" | "date" | "all", date: string | null}} */
export function parseTokenDateFilter(value, now, zone) {
  if (value === "all") return { mode: "all", date: null };
  if (supportedDate(value)) return { mode: "date", date: value };
  return { mode: "today", date: tokenCalendarDate(now, zone) };
}

/** @param {string} date @param {TokenZone} zone @returns {{start: string, end: string}} */
export function tokenDayBounds(date, zone) {
  if (!supportedDate(date) || !Object.hasOwn(TOKEN_ZONE_OFFSETS, zone)) throw new Error("Tanggal atau zona filter tidak valid.");
  const start = Date.parse(`${date}T00:00:00.000Z`) - TOKEN_ZONE_OFFSETS[zone] * 3_600_000;
  return { start: new Date(start).toISOString(), end: new Date(start + 86_400_000).toISOString() };
}

/** @param {unknown} raw @returns {number} */
export function tokenPageNumber(raw) {
  return typeof raw === "string" && /^[1-9]\d{0,6}$/.test(raw) ? Number(raw) : 1;
}
