import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Tepat 32 simbol tanpa I/O/0/1. Dua belas simbol acak = 60 bit entropi.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DOMAIN = "NusaCBT exam access token v1\0";
/** @returns {string} */
export function generateExamToken() {
  const bytes = randomBytes(12);
  const raw = Array.from(bytes, (byte) => ALPHABET[byte & 31]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

/** @param {unknown} value @returns {string | null} */
export function normalizeExamToken(value) {
  if (typeof value !== "string" || value.length > 40 || !/^[A-Za-z2-9 -]+$/.test(value)) return null;
  const code = value.toUpperCase().replace(/[ -]/g, "");
  return code.length === 12 && Array.from(code).every((character) => ALPHABET.includes(character)) ? code : null;
}

/** @param {unknown} value @returns {Buffer} */
export function digestExamToken(value) {
  const code = normalizeExamToken(value);
  if (!code) throw new Error("Format token tidak valid.");
  return createHash("sha256").update(DOMAIN, "utf8").update(code, "ascii").digest();
}

/** Pencocokan ini saja BUKAN otorisasi mulai ujian; aturan cakupan, expiry,
 * sesi peserta, batas percobaan dan transaksi atomik tetap wajib diterapkan.
 * @param {unknown} value @param {unknown} digest @returns {boolean} */
export function matchesExamToken(value, digest) {
  if (!Buffer.isBuffer(digest) || digest.length !== 32 || !normalizeExamToken(value)) return false;
  return timingSafeEqual(digestExamToken(value), digest);
}

/** Aturan yang dipilih untuk modul pengerjaan mendatang. Ini bukan pemeriksaan
 * database dan belum mengizinkan peserta memulai tes.
 * @param {boolean} specificActive @param {boolean} globalActive
 * @returns {"test" | "global" | null} */
export function effectiveExamTokenScope(specificActive, globalActive) {
  return specificActive ? "test" : globalActive ? "global" : null;
}
