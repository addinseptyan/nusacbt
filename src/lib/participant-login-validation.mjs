import { createHash } from "node:crypto";

import { validateParticipantUsername } from "./participant-identity-validation.mjs";

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

// Login tetap menerima sandi lama; aturan delapan huruf hanya untuk sandi baru/reset.
// Periode tidak berasal dari formulir, melainkan diambil server di dalam transaksi.
/** @param {unknown} username @param {unknown} password */
export function parseParticipantCredentials(username, password) {
  if (typeof username !== "string" || username.length > 128) return null;
  const checked = validateParticipantUsername(username);
  if (!checked.ok || typeof password !== "string" || password.length < 1 ||
      password.length > 256 || !password.isWellFormed() || Buffer.byteLength(password, "utf8") > 512) return null;
  return { username: checked.value.toLowerCase(), password };
}

/** @param {string} periodId @param {string} normalizedUsername */
export function participantAttemptBucket(periodId, normalizedUsername) {
  return createHash("sha256").update("NusaCBT participant login v1\0").update(periodId).update("\0").update(normalizedUsername).digest();
}

/** @param {unknown} token @returns {Buffer | null} */
export function participantSessionDigest(token) {
  if (typeof token !== "string" || !TOKEN_FORMAT.test(token)) return null;
  return createHash("sha256").update(token).digest();
}

/** @param {unknown} value */
export function participantPageNumber(value) {
  return typeof value === "string" && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : 1;
}
