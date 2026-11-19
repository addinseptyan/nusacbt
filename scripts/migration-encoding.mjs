// SQL_ASCII tidak memvalidasi Unicode dan dapat menganggap karakter Arab,
// emoji, atau simbol sebagai karakter kontrol. Jangan mencoba konversi otomatis.
/** @param {{ query: (sql: string) => Promise<{ rows: { encoding?: string }[] }> }} client */
export async function requireUtf8Database(client) {
  const result = await client.query("SELECT current_setting('server_encoding') AS encoding");
  if (result.rows[0]?.encoding !== "UTF8") {
    throw new Error("Database harus menggunakan encoding UTF8. Tidak ada migrasi dijalankan; periksa target dan minta panduan pemindahan data yang aman.");
  }
}
