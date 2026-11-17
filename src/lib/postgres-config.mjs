/** @returns {import('pg').PoolConfig} */
export function postgresConfig() {
  const host = process.env.PGHOST?.trim();
  const database = process.env.PGDATABASE?.trim();
  const user = process.env.PGUSER?.trim();
  const password = process.env.PGPASSWORD;
  const rawPort = process.env.PGPORT || "5432";
  const port = Number(rawPort);

  if (!host || !database || !user || !password) {
    throw new Error("Konfigurasi PostgreSQL belum lengkap. Periksa file .env.local.");
  }
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PGPORT harus berupa nomor port yang valid.");
  }

  return { host, port, database, user, password, connectionTimeoutMillis: 5000 };
}
