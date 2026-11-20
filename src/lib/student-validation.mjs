/**
 * @param {unknown} value
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
export function validateStudentName(value) {
  if (typeof value !== "string") return { ok: false, error: "Nama siswa wajib diisi." };
  const input = value.trim();
  // Periksa panjang SETELAH kapitalisasi: beberapa karakter Unicode dapat
  // berkembang menjadi lebih dari satu karakter (misalnya ß menjadi SS).
  const name = input.toUpperCase();
  if (!name || !input.isWellFormed() || Array.from(name).length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, error: "Nama siswa wajib diisi, maksimal 100 karakter setelah kapitalisasi, tanpa karakter kontrol atau Unicode tidak valid." };
  }
  return { ok: true, value: name };
}

/**
 * NISN diperlakukan sebagai teks supaya nol di depan tidak hilang.
 * @param {unknown} value
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
export function validateNisn(value) {
  if (typeof value !== "string" || !/^[0-9]{10}$/.test(value.trim())) {
    return { ok: false, error: "NISN wajib diisi dengan tepat 10 digit angka." };
  }
  return { ok: true, value: value.trim() };
}

/**
 * @param {{name: unknown, nisn: unknown}} input
 * @returns {{ok: true, value: {name: string, nisn: string}} | {ok: false, error: string}}
 */
export function validateStudentInput(input) {
  const name = validateStudentName(input.name);
  if (!name.ok) return name;
  const nisn = validateNisn(input.nisn);
  if (!nisn.ok) return nisn;
  return { ok: true, value: { name: name.value, nisn: nisn.value } };
}
