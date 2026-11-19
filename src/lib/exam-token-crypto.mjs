import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const SALT = Buffer.from("NusaCBT exam token master key v2", "utf8");
const KEY_BYTES = 32;

/** @returns {string} */
export function generateSixDigitToken() {
  // CSPRNG tanpa bias; nol di depan adalah bagian dari kode.
  return String(randomInt(1_000_000)).padStart(6, "0");
}
/** @param {unknown} value @returns {string | null} */
export function normalizeSixDigitToken(value) {
  return typeof value === "string" && /^[0-9]{6}$/.test(value) ? value : null;
}
/** @param {Buffer} master @param {string} purpose @returns {Buffer} */
function derive(master, purpose) {
  if (!Buffer.isBuffer(master) || master.length !== KEY_BYTES) throw new Error("Kunci token tidak valid.");
  return Buffer.from(hkdfSync("sha256", master, SALT, Buffer.from(purpose, "utf8"), KEY_BYTES));
}
/** @param {Buffer} master @returns {Buffer} */
export function examTokenKeyVerifier(master) {
  const key = derive(master, "key-binding-v1");
  try { return createHmac("sha256", key).update("NusaCBT exam token key verifier v1", "utf8").digest(); }
  finally { key.fill(0); }
}
/** @param {unknown} left @param {unknown} right @returns {boolean} */
export function sameTokenVerifier(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === KEY_BYTES && right.length === KEY_BYTES && timingSafeEqual(left, right);
}
/** @param {unknown} code @param {Buffer} master @returns {Buffer} */
export function digestSixDigitToken(code, master) {
  const normalized = normalizeSixDigitToken(code);
  if (!normalized) throw new Error("Kode token harus tepat enam angka.");
  const key = derive(master, "token-hmac-v1");
  try { return createHmac("sha256", key).update("NusaCBT exam token lookup v2\0", "utf8").update(normalized, "ascii").digest(); }
  finally { key.fill(0); }
}
/** @param {{id: string, scope: string}} binding @returns {Buffer} */
function aad(binding) {
  if (!/^[1-9]\d{0,18}$/.test(binding.id) || BigInt(binding.id) > 9223372036854775807n || !["global", "test"].includes(binding.scope)) throw new Error("Identitas token tidak valid.");
  // ID dan scope tetap ada setelah penghapusan tes; ciphertext tidak bisa
  // dipindahkan ke token lain atau diubah scope-nya tanpa terdeteksi.
  return Buffer.from(JSON.stringify(["nusacbt-exam-token-v2", binding.id, binding.scope]), "utf8");
}
/** @param {unknown} code @param {Buffer} master @param {{id: string, scope: string}} binding */
export function encryptSixDigitToken(code, master, binding) {
  const normalized = normalizeSixDigitToken(code);
  if (!normalized) throw new Error("Kode token harus tepat enam angka.");
  const key = derive(master, "aes-256-gcm-v1");
  try {
    const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad(binding));
    const ciphertext = Buffer.concat([cipher.update(normalized, "ascii"), cipher.final()]);
    return { nonce, ciphertext, tag: cipher.getAuthTag() };
  } finally { key.fill(0); }
}
/** @param {{nonce: Buffer, ciphertext: Buffer, tag: Buffer}} stored @param {Buffer} master @param {{id: string, scope: string}} binding @returns {string} */
export function decryptSixDigitToken(stored, master, binding) {
  if (!Buffer.isBuffer(stored.nonce) || stored.nonce.length !== 12 || !Buffer.isBuffer(stored.ciphertext) || stored.ciphertext.length !== 6 || !Buffer.isBuffer(stored.tag) || stored.tag.length !== 16) throw new Error("Data token terenkripsi tidak valid.");
  const key = derive(master, "aes-256-gcm-v1");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, stored.nonce, { authTagLength: 16 });
    decipher.setAAD(aad(binding)); decipher.setAuthTag(stored.tag);
    const plain = Buffer.concat([decipher.update(stored.ciphertext), decipher.final()]);
    try { const code = plain.toString("ascii"); if (!normalizeSixDigitToken(code)) throw new Error("Data token tidak valid."); return code; }
    finally { plain.fill(0); }
  } finally { key.fill(0); }
}
