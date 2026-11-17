/**
 * @param {unknown} value
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
export function validateMajorName(value) {
  if (typeof value !== "string") return { ok: false, error: "Nama atau kode jurusan wajib diisi." };
  const name = value.trim();
  if (!name || Array.from(name).length > 60 || /[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, error: "Nama atau kode jurusan wajib diisi, maksimal 60 karakter, tanpa karakter kontrol." };
  }
  return { ok: true, value: name };
}

/**
 * @param {unknown} value
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
export function validateClassLevel(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9]{1,12}$/.test(value.trim())) {
    return { ok: false, error: "Tingkat wajib diisi dengan huruf atau angka tanpa spasi, misalnya X, XI, atau XII." };
  }
  return { ok: true, value: value.trim().toUpperCase() };
}

/** @param {unknown} value @returns {string | null} */
export function validDataId(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/.test(value)) return null;
  if (BigInt(value) > BigInt("9223372036854775807")) return null;
  return value;
}
