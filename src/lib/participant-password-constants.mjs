// Membatasi biaya scrypt dan durasi permintaan pembuatan sandi otomatis.
export const PARTICIPANT_PASSWORD_BATCH_SIZE = 25;
export const GENERATED_PARTICIPANT_PASSWORD_LENGTH = 8;
export const NEW_PARTICIPANT_PASSWORD_ERROR = "Sandi baru harus tepat 8 huruf kapital A–Z, tanpa angka atau spasi.";

/** @param {unknown} value @returns {value is string} */
export function isNewParticipantPassword(value) {
  // Pemeriksaan panjang juga menolak newline akhir yang dapat cocok dengan `$` di JavaScript.
  return typeof value === "string" && value.length === 8 && /^[A-Z]{8}$/.test(value);
}
