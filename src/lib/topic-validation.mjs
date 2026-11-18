/**
 * @param {unknown} value
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
export function validateTopicName(value) {
  const invalid = { ok: false, error: "Nama wajib diisi, maksimal 100 karakter, tanpa karakter kontrol." };
  if (typeof value !== "string" || value.length > 1024 || !value.isWellFormed() || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return invalid;
  const name = value.trim();
  if (!name || Array.from(name).length > 100) return invalid;
  return { ok: true, value: name };
}

/**
 * xmin adalah versi baris PostgreSQL, digunakan untuk mendeteksi formulir usang.
 * @param {unknown} value
 * @returns {string | null}
 */
export function validTopicRevision(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,9}$/.test(value)) return null;
  return BigInt(value) <= BigInt("4294967295") ? value : null;
}
