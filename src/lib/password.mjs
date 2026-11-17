import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 32768;
const R = 8;
const P = 3;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const MAX_PASSWORD_BYTES = 512;
const options = { N, r: R, p: P, maxmem: 64 * 1024 * 1024 };

/** @param {string} password */
export function validNewAdminPassword(password) {
  return typeof password === "string" && password.length >= 12 && password.length <= 128 && Buffer.byteLength(password, "utf8") <= MAX_PASSWORD_BYTES;
}

/** @param {string} password @param {Buffer} salt @returns {Promise<Buffer>} */
function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** @param {string} password @returns {Promise<string>} */
export async function hashPassword(password) {
  if (!validNewAdminPassword(password)) {
    throw new Error("Kata sandi admin harus 12–128 karakter dan maksimal 512 byte.");
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** @param {string} password @param {string} encoded @returns {Promise<boolean>} */
export async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES || typeof encoded !== "string") return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || parts[1] !== String(N) || parts[2] !== String(R) || parts[3] !== String(P)) return false;
  if (!/^[A-Za-z0-9_-]{22}$/.test(parts[4]) || !/^[A-Za-z0-9_-]{86}$/.test(parts[5])) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}
