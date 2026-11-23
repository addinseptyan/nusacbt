// Upgrade 026 -> 027 memakai skema sementara di dalam database uji.
// Seluruh DDL dan fixture dibatalkan pada akhir transaksi; database lain tidak disentuh.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";

if (process.env.PGDATABASE !== "nusacbt_test" || process.env.NUSACBT_CONFIRM_TEST_DATABASE !== "nusacbt_test") {
  throw new Error("Wajib database terisolasi nusacbt_test dan NUSACBT_CONFIRM_TEST_DATABASE=nusacbt_test.");
}
const root = fileURLToPath(new URL("../..", import.meta.url));
const schema = `upgrade_027_${randomBytes(6).toString("hex")}`;
const client = new pg.Client(postgresConfig());
const quote = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error("Identifier uji tidak valid");
  return `"${s}"`;
};

async function snapshot(tables) {
  const out = {};
  for (const table of tables) {
    const data = await client.query(
      `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows FROM ${quote(table)} r`,
    );
    out[table] = createHash("sha256").update(JSON.stringify(data.rows[0].rows)).digest("hex");
  }
  return out;
}

async function rejects(sql, params, codes) {
  await client.query("SAVEPOINT constraint_check");
  await assert.rejects(client.query(sql, params), (e) => codes.includes(e.code));
  await client.query("ROLLBACK TO SAVEPOINT constraint_check");
}

try {
  await client.connect();
  assert.equal((await client.query("SELECT current_database() AS db")).rows[0].db, "nusacbt_test");
  await client.query("BEGIN");
  await client.query(`CREATE SCHEMA ${quote(schema)}`);
  await client.query(`SET LOCAL search_path TO ${quote(schema)}, pg_catalog`);

  const files = (await readdir(join(root, "migrations"))).filter((x) => /^\d+_[a-z0-9_]+\.sql$/.test(x)).sort();
  const old = files.filter((x) => Number(x.slice(0, 3)) <= 26);
  assert.equal(old.length, 26);
  for (const file of old) await client.query(await readFile(join(root, "migrations", file), "utf8"));

  const adminId = (await client.query(
    "INSERT INTO admin_users(username,full_name,password_hash,is_superuser,is_active) VALUES('upgrade027admin','Admin Upgrade 027','fixture_hash',true,true) RETURNING id::text AS id",
  )).rows[0].id;
  await client.query("INSERT INTO academic_years(name) VALUES('2026/2027')");
  await client.query("UPDATE app_settings SET school_name = 'SMA Upgrade 027', revision = revision + 1 WHERE id = 1");

  const tables = (await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",
    [schema],
  )).rows.map((r) => r.table_name);
  const before = await snapshot(tables);
  const sequences = (await client.query(
    "SELECT sequencename,last_value FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename",
    [schema],
  )).rows;

  await client.query(await readFile(join(root, "migrations", "027_database_backup_audit.sql"), "utf8"));

  assert.deepEqual(await snapshot(tables), before, "Seluruh 50 tabel sebelum 027 harus tetap identik.");
  const afterSequences = (await client.query(
    "SELECT sequencename,last_value FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename",
    [schema],
  )).rows;
  for (const row of sequences) {
    assert.deepEqual(afterSequences.find((x) => x.sequencename === row.sequencename), row);
  }

  const validHash = "a".repeat(64);
  const op1 = randomUUID();
  const op2 = randomUUID();
  await client.query(
    `INSERT INTO database_backup_audit (operation_id, action, actor_id, actor_username_snapshot, archive_filename, archive_sha256, schema_version, table_count, row_count, blob_count, byte_size, detail)
     VALUES ($1::uuid, 'backup', $2::bigint, 'upgrade027admin', 'backup-nusacbt-test.zip', $3, '027_database_backup_audit.sql', 51, 12, 0, 2048, 'Cadangan uji')`,
    [op1, adminId, validHash],
  );
  await client.query(
    `INSERT INTO database_backup_audit (operation_id, action, actor_id, actor_username_snapshot, archive_filename, archive_sha256, schema_version, table_count, row_count, blob_count, byte_size, detail)
     VALUES ($1::uuid, 'restore', NULL, 'admin_lama', 'backup-nusacbt-test.zip', $2, '027_database_backup_audit.sql', 51, 12, 0, 2048, 'Pemulihan uji')`,
    [op2, validHash],
  );

  // Constraint CHECK & UNIQUE harus menolak nilai rusak.
  await rejects(
    `INSERT INTO database_backup_audit (operation_id, action, actor_id, actor_username_snapshot, archive_filename, archive_sha256, schema_version, table_count, row_count, blob_count, byte_size)
     VALUES ($1::uuid, 'backup', $2::bigint, 'upgrade027admin', 'dup.zip', $3, '027', 51, 0, 0, 100)`,
    [op1, adminId, validHash],
    ["23505"],
  );
  await rejects(
    `INSERT INTO database_backup_audit (operation_id, action, actor_id, actor_username_snapshot, archive_filename, archive_sha256, schema_version, table_count, row_count, blob_count, byte_size)
     VALUES ($1::uuid, 'delete', $2::bigint, 'upgrade027admin', 'bad.zip', $3, '027', 51, 0, 0, 100)`,
    [randomUUID(), adminId, validHash],
    ["23514"],
  );
  await rejects(
    `INSERT INTO database_backup_audit (operation_id, action, actor_id, actor_username_snapshot, archive_filename, archive_sha256, schema_version, table_count, row_count, blob_count, byte_size)
     VALUES ($1::uuid, 'backup', $2::bigint, 'upgrade027admin', 'bad.zip', $3, '027', 51, 0, 0, 100)`,
    [randomUUID(), adminId, "bukan-sha256"],
    ["23514"],
  );
  await rejects(
    `INSERT INTO database_backup_audit (operation_id, action, actor_id, actor_username_snapshot, archive_filename, archive_sha256, schema_version, table_count, row_count, blob_count, byte_size)
     VALUES ($1::uuid, 'backup', $2::bigint, 'upgrade027admin', 'bad.zip', $3, '027', 0, 0, 0, 100)`,
    [randomUUID(), adminId, validHash],
    ["23514"],
  );

  console.log(`Upgrade 026->027 lulus: ${tables.length} tabel lama & ${sequences.length} sequence identik; database_backup_audit aktif & tervalidasi.`);
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end().catch(() => {});
}
