import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";

import { postgresConfig } from "../src/lib/postgres-config.mjs";
import { requireUtf8Database } from "./migration-encoding.mjs";

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrationLock = 2026111701;
let client;
let locked = false;

try {
  client = new pg.Client(postgresConfig());
  await client.connect();
  // Pastikan encoding sebelum membuat tabel riwayat atau menjalankan migrasi.
  await requireUtf8Database(client);
  await client.query("SELECT pg_advisory_lock($1)", [migrationLock]);
  locked = true;
  await client.query(`CREATE TABLE IF NOT EXISTS nusacbt_schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(migrationsDir)).filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file)).sort();
  if (files.length === 0) throw new Error("Tidak ada file migrasi yang ditemukan.");
  for (const file of files) {
    // Git pada Windows dapat mengubah LF menjadi CRLF tanpa mengubah isi migrasi.
    const sql = (await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query("SELECT checksum FROM nusacbt_schema_migrations WHERE version = $1", [file]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Migrasi ${file} sudah diterapkan tetapi isinya berubah.`);
      console.log(`Sudah diterapkan: ${file}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO nusacbt_schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum]);
      await client.query("COMMIT");
      console.log(`Berhasil menerapkan: ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} catch (error) {
  console.error("Migrasi gagal:", error instanceof Error ? error.message : "kesalahan database");
  process.exitCode = 1;
} finally {
  if (client) {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [migrationLock]).catch(() => {});
    await client.end().catch(() => {});
  }
}
