import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

import { GENERATED_PARTICIPANT_PASSWORD_LENGTH, isNewParticipantPassword, NEW_PARTICIPANT_PASSWORD_ERROR } from "./participant-password-constants.mjs";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_KEY_FILE_BYTES = 128;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const KDF_SALT = Buffer.from("NusaCBT participant password master key v1", "utf8");

export class ParticipantKeyFileError extends Error {
  /** @param {"missing"|"invalid"|"inside_project"|"unreadable"|"exists"} reason */
  constructor(reason) {
    super("Kunci sandi peserta belum dapat digunakan.");
    this.name = "ParticipantKeyFileError";
    this.reason = reason;
  }
}

/** @param {unknown} password @returns {{ok: true, value: string} | {ok: false, error: string}} */
export function validateParticipantPassword(password) {
  if (!isNewParticipantPassword(password)) {
    return { ok: false, error: NEW_PARTICIPANT_PASSWORD_ERROR };
  }
  return { ok: true, value: password };
}

// Hanya untuk membuka data yang sudah tersimpan sebelum aturan baru. Tidak
// dipakai untuk membuat/reset sandi: format lama harus tetap bisa ditampilkan.
/** @param {string} password @returns {boolean} */
function validStoredParticipantPassword(password) {
  if (validateParticipantPassword(password).ok) return true;
  if (typeof password !== "string" || password.length > 256 || !password.isWellFormed() ||
      Buffer.byteLength(password, "utf8") > 512 || /[\u0000-\u001f\u007f-\u009f]/.test(password)) return false;
  const length = Array.from(password).length;
  return length >= 12 && length <= 128;
}

/** @returns {string} */
export function generateParticipantPassword() {
  let result = "";
  for (let index = 0; index < GENERATED_PARTICIPANT_PASSWORD_LENGTH; index += 1) {
    result += ALPHABET[randomInt(ALPHABET.length)];
  }
  return result;
}

/** @param {string} projectRoot @param {string} candidate */
function withinProject(projectRoot, candidate) {
  const part = relative(projectRoot, candidate);
  return part === "" || (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}

// Tolak pula lokasi dalam repository mana pun, termasuk Git worktree, dan
// salinan aplikasi tanpa .git. Root aplikasi diberikan eksplisit oleh pemanggil.
/** @param {string} directory @returns {Promise<boolean>} */
async function insideRepositoryOrApp(directory) {
  let current = directory;
  for (;;) {
    try {
      await lstat(join(current, ".git"));
      return true;
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || !["ENOENT", "ENOTDIR"].includes(String(error.code))) throw error;
    }
    try {
      const packagePath = join(current, "package.json");
      const info = await lstat(packagePath);
      if (info.isFile() && info.size <= 128 * 1024) {
        const contents = await readFile(packagePath, "utf8");
        let name = null;
        try { name = JSON.parse(contents)?.name; } catch { /* Metadata yang bukan JSON diabaikan. */ }
        if (name === "nusacbt") return true;
      }
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || !["ENOENT", "ENOTDIR"].includes(String(error.code))) throw error;
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/** @param {unknown} rawPath @param {string} projectRoot */
async function checkedPath(rawPath, projectRoot) {
  if (typeof rawPath !== "string" || !rawPath.trim()) throw new ParticipantKeyFileError("missing");
  if (rawPath !== rawPath.trim() || !isAbsolute(rawPath)) throw new ParticipantKeyFileError("invalid");
  if (typeof projectRoot !== "string" || !isAbsolute(projectRoot)) throw new ParticipantKeyFileError("unreadable");
  try {
    const root = await realpath(projectRoot);
    const parent = await realpath(dirname(rawPath));
    const target = join(parent, basename(rawPath));
    if (withinProject(root, target) || await insideRepositoryOrApp(parent)) throw new ParticipantKeyFileError("inside_project");
    return { root, target };
  } catch (error) {
    if (error instanceof ParticipantKeyFileError) throw error;
    throw new ParticipantKeyFileError("unreadable");
  }
}

/**
 * Membuat file kunci baru di luar proyek, tidak pernah menimpa file yang sudah ada.
 * @param {unknown} rawPath
 * @param {string} projectRoot
 */
export async function createParticipantKeyFile(rawPath, projectRoot) {
  const { target } = await checkedPath(rawPath, projectRoot);
  let handle;
  try {
    handle = await open(target, "wx", 0o600);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new ParticipantKeyFileError("exists");
    }
    throw new ParticipantKeyFileError("unreadable");
  }
  const key = randomBytes(KEY_BYTES);
  try {
    await handle.writeFile(`${key.toString("base64")}\n`, "utf8");
    await handle.sync();
  } catch {
    await handle.close().catch(() => {});
    await unlink(target).catch(() => {});
    throw new ParticipantKeyFileError("unreadable");
  } finally {
    key.fill(0);
  }
  await handle.close();
}

/**
 * Membaca tepat satu kunci acak 32-byte dari file luar proyek.
 * @param {unknown} rawPath
 * @param {string} projectRoot
 * @returns {Promise<Buffer>}
 */
export async function readParticipantKeyFile(rawPath, projectRoot) {
  const { root, target } = await checkedPath(rawPath, projectRoot);
  let handle;
  try {
    const actual = await realpath(target);
    if (withinProject(root, actual) || await insideRepositoryOrApp(dirname(actual))) throw new ParticipantKeyFileError("inside_project");
    handle = await open(actual, "r");
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > MAX_KEY_FILE_BYTES) throw new ParticipantKeyFileError("invalid");
    const buffer = Buffer.alloc(MAX_KEY_FILE_BYTES + 1);
    let raw;
    try {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_KEY_FILE_BYTES) throw new ParticipantKeyFileError("invalid");
      raw = buffer.subarray(0, bytesRead).toString("utf8").trim();
    } finally { buffer.fill(0); }
    if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new ParticipantKeyFileError("invalid");
    const key = Buffer.from(raw, "base64");
    if (key.length !== KEY_BYTES || key.toString("base64") !== raw) {
      key.fill(0);
      throw new ParticipantKeyFileError("invalid");
    }
    return key;
  } catch (error) {
    if (error instanceof ParticipantKeyFileError) throw error;
    throw new ParticipantKeyFileError("unreadable");
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** @param {Buffer} master @param {string} purpose @returns {Buffer} */
function deriveKey(master, purpose) {
  if (!Buffer.isBuffer(master) || master.length !== KEY_BYTES) throw new Error("Kunci sandi tidak valid.");
  return Buffer.from(hkdfSync("sha256", master, KDF_SALT, Buffer.from(purpose, "utf8"), KEY_BYTES));
}

/** @param {Buffer} master @returns {Buffer} */
export function participantKeyVerifier(master) {
  const key = deriveKey(master, "key-verifier-v1");
  try { return createHmac("sha256", key).update("NusaCBT participant key binding v1", "utf8").digest(); }
  finally { key.fill(0); }
}

/** @param {Buffer} left @param {Buffer} right @returns {boolean} */
export function sameParticipantVerifier(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === KEY_BYTES && right.length === KEY_BYTES && timingSafeEqual(left, right);
}

/** @param {{identityId: string, periodId: string}} binding */
function additionalData(binding) {
  if (!/^[1-9]\d{0,18}$/.test(binding.identityId) || !/^[1-9]\d{0,18}$/.test(binding.periodId)) {
    throw new Error("Identitas sandi tidak valid.");
  }
  return Buffer.from(JSON.stringify(["nusacbt-participant-password-v1", binding.periodId, binding.identityId]), "utf8");
}

/** @param {string} password @param {Buffer} master @param {{identityId: string, periodId: string}} binding */
export function encryptParticipantPassword(password, master, binding) {
  const checked = validateParticipantPassword(password);
  if (!checked.ok) throw new Error(checked.error);
  const key = deriveKey(master, "aes-256-gcm-v1");
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(additionalData(binding));
    const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
    return { nonce, ciphertext, authenticationTag: cipher.getAuthTag() };
  } finally { key.fill(0); }
}

/**
 * @param {{nonce: Buffer, ciphertext: Buffer, authenticationTag: Buffer}} encrypted
 * @param {Buffer} master
 * @param {{identityId: string, periodId: string}} binding
 * @returns {string}
 */
export function decryptParticipantPassword(encrypted, master, binding) {
  const key = deriveKey(master, "aes-256-gcm-v1");
  try {
    if (!Buffer.isBuffer(encrypted.nonce) || encrypted.nonce.length !== NONCE_BYTES ||
        !Buffer.isBuffer(encrypted.authenticationTag) || encrypted.authenticationTag.length !== TAG_BYTES ||
        !Buffer.isBuffer(encrypted.ciphertext) || encrypted.ciphertext.length < 8 || encrypted.ciphertext.length > 512) {
      throw new Error("Data sandi tidak valid.");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, encrypted.nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalData(binding));
    decipher.setAuthTag(encrypted.authenticationTag);
    const plaintext = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
    try {
      const password = plaintext.toString("utf8");
      if (!validStoredParticipantPassword(password)) throw new Error("Data sandi tidak valid.");
      return password;
    } finally { plaintext.fill(0); }
  } finally { key.fill(0); }
}
