import { randomInt } from "node:crypto";

import { MAX_IDENTITY_BATCH } from "./participant-identity-constants.mjs";
import { isValidCalendarDate } from "./period-validation.mjs";

export { DEFAULT_IDENTITY_PATTERN, MAX_IDENTITY_BATCH } from "./participant-identity-constants.mjs";
const PREFIX_RE = /^[A-Za-z0-9._-]{0,24}$/;
const NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const TOKENS = ["{prefix}", "{YYYYMM}", "{acak3}"];

/** @param {unknown} value @returns {{ok: true, value: string} | {ok: false, error: string}} */
export function validateParticipantNumber(value) {
  if (typeof value !== "string" || !NUMBER_RE.test(value.trim())) {
    return { ok: false, error: "Nomor peserta wajib 1–64 karakter: huruf atau angka di awal, lalu huruf, angka, titik, garis bawah, atau tanda hubung." };
  }
  return { ok: true, value: value.trim() };
}

/** @param {unknown} value @returns {{ok: true, value: string} | {ok: false, error: string}} */
export function validateParticipantUsername(value) {
  if (typeof value !== "string" || !USERNAME_RE.test(value.trim())) {
    return { ok: false, error: "Username wajib 3–64 karakter: huruf atau angka di awal, lalu huruf, angka, titik, garis bawah, atau tanda hubung." };
  }
  return { ok: true, value: value.trim() };
}

/** @param {unknown} value @returns {{ok: true, value: string} | {ok: false, error: string}} */
export function validateIdentityPrefix(value) {
  if (typeof value !== "string" || !PREFIX_RE.test(value.trim())) {
    return { ok: false, error: "Prefix boleh kosong atau maksimal 24 karakter: huruf, angka, titik, garis bawah, atau tanda hubung." };
  }
  return { ok: true, value: value.trim() };
}

/** @param {string} pattern @param {string} prefix @param {string} startDate @param {number} suffix */
function formatIdentity(pattern, prefix, startDate, suffix) {
  return pattern.replace("{prefix}", prefix)
    .replace("{YYYYMM}", startDate.slice(0, 7).replace("-", ""))
    .replace("{acak3}", String(suffix).padStart(3, "0"));
}

/**
 * Pola adalah template terbatas, bukan ekspresi atau kode yang dieksekusi.
 * @param {unknown} raw
 * @param {string} prefix
 * @param {string} startDate
 * @param {"Nomor peserta"|"Username"} label
 * @returns {{ok: true, value: string, sample: string} | {ok: false, error: string}}
 */
export function validateIdentityPattern(raw, prefix, startDate, label) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 128 || !isValidCalendarDate(startDate)) {
    return { ok: false, error: `Pola ${label.toLowerCase()} atau tanggal periode tidak valid.` };
  }
  const pattern = raw.trim();
  const counts = TOKENS.map((token) => pattern.split(token).length - 1);
  const literal = pattern.replace(/\{(?:prefix|YYYYMM|acak3)\}/g, "");
  if (counts[0] > 1 || counts[1] > 1 || counts[2] !== 1 || !/^[A-Za-z0-9._-]*$/.test(literal)) {
    return { ok: false, error: `Pola ${label.toLowerCase()} harus memiliki {acak3} sekali; {prefix} dan {YYYYMM} boleh dipakai masing-masing sekali. Karakter lain hanya huruf, angka, titik, garis bawah, atau tanda hubung.` };
  }
  const sample = formatIdentity(pattern, prefix, startDate, 0);
  const checked = label === "Username" ? validateParticipantUsername(sample) : validateParticipantNumber(sample);
  if (!checked.ok) return { ok: false, error: `Hasil pola ${label.toLowerCase()} tidak valid. ${checked.error}` };
  return { ok: true, value: pattern, sample };
}

/**
 * @param {{count: number, prefix: unknown, numberPattern: unknown, usernamePattern: unknown, startDate: string, usedNumbers: string[], usedUsernames: string[]}} input
 * @param {(max: number) => number} [randomIndex]
 * @returns {{ok: true, values: Array<{number: string, username: string}>} | {ok: false, error: string}}
 */
export function planAutomaticIdentities(input, randomIndex = randomInt) {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_IDENTITY_BATCH) {
    return { ok: false, error: "Pembuatan otomatis memerlukan 1–1.000 siswa per batch." };
  }
  const prefix = validateIdentityPrefix(input.prefix);
  if (!prefix.ok) return prefix;
  const numberPattern = validateIdentityPattern(input.numberPattern, prefix.value, input.startDate, "Nomor peserta");
  if (!numberPattern.ok) return numberPattern;
  const usernamePattern = validateIdentityPattern(input.usernamePattern, prefix.value, input.startDate, "Username");
  if (!usernamePattern.ok) return usernamePattern;

  /** @param {string} pattern @param {Set<string>} used */
  function allocate(pattern, used) {
    const suffixes = Array.from({ length: 1000 }, (_, index) => index);
    // Fisher–Yates memilih semua kemungkinan tanpa pengulangan atau retry tak terbatas.
    for (let i = suffixes.length - 1; i > 0; i -= 1) {
      const j = randomIndex(i + 1);
      if (!Number.isInteger(j) || j < 0 || j > i) throw new Error("Sumber angka acak tidak valid.");
      [suffixes[i], suffixes[j]] = [suffixes[j], suffixes[i]];
    }
    const values = [];
    for (const suffix of suffixes) {
      const value = formatIdentity(pattern, prefix.value, input.startDate, suffix);
      const key = value.toLowerCase();
      if (used.has(key)) continue;
      used.add(key);
      values.push(value);
      if (values.length === input.count) break;
    }
    return values;
  }

  const usedNumbers = new Set(input.usedNumbers.map((value) => value.toLowerCase()));
  const usedUsernames = new Set(input.usedUsernames.map((value) => value.toLowerCase()));
  if (numberPattern.value === usernamePattern.value) {
    const both = new Set([...usedNumbers, ...usedUsernames]);
    const values = allocate(numberPattern.value, both);
    if (values.length !== input.count) {
      return { ok: false, error: "Kombinasi nomor dan username pada pola ini tidak cukup. Tidak ada data yang disimpan; ubah prefix atau pola." };
    }
    return { ok: true, values: values.map((value) => ({ number: value, username: value })) };
  }
  const numbers = allocate(numberPattern.value, usedNumbers);
  const usernames = allocate(usernamePattern.value, usedUsernames);
  if (numbers.length !== input.count || usernames.length !== input.count) {
    return { ok: false, error: "Kombinasi nomor atau username pada pola ini tidak cukup. Tidak ada data yang disimpan; ubah prefix atau pola." };
  }
  return { ok: true, values: numbers.map((number, index) => ({ number, username: usernames[index] })) };
}
