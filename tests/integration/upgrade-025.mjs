// Upgrade 024 -> 025 memakai skema sementara di dalam database uji.
// Seluruh DDL dan fixture dibatalkan pada akhir transaksi; database lain tidak disentuh.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
import { postgresConfig } from '../../src/lib/postgres-config.mjs';

if (process.env.PGDATABASE !== 'nusacbt_test' || process.env.NUSACBT_CONFIRM_TEST_DATABASE !== 'nusacbt_test') {
  throw new Error('Wajib database terisolasi nusacbt_test dan NUSACBT_CONFIRM_TEST_DATABASE=nusacbt_test.');
}
const root = fileURLToPath(new URL('../..', import.meta.url));
const schema = `upgrade_025_${randomBytes(6).toString('hex')}`;
const client = new pg.Client(postgresConfig());
const quote = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('Identifier uji tidak valid'); return `"${s}"`; };
async function snapshot(tables) {
  const out = {};
  for (const table of tables) {
    const data = await client.query(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows FROM ${quote(table)} r`);
    out[table] = createHash('sha256').update(JSON.stringify(data.rows[0].rows)).digest('hex');
  }
  return out;
}
async function rejects(sql, params, codes) {
  await client.query('SAVEPOINT constraint_check');
  await assert.rejects(client.query(sql, params), (e) => codes.includes(e.code));
  await client.query('ROLLBACK TO SAVEPOINT constraint_check');
}
try {
  await client.connect();
  assert.equal((await client.query('SELECT current_database() AS db')).rows[0].db, 'nusacbt_test');
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA ${quote(schema)}`);
  await client.query(`SET LOCAL search_path TO ${quote(schema)}, pg_catalog`);
  const files = (await readdir(join(root, 'migrations'))).filter((x) => /^\d+_[a-z0-9_]+\.sql$/.test(x)).sort();
  const old = files.filter((x) => Number(x.slice(0, 3)) <= 24);
  assert.equal(old.length, 24);
  for (const file of old) await client.query(await readFile(join(root, 'migrations', file), 'utf8'));

  const admin = (await client.query("INSERT INTO admin_users(username,password_hash) VALUES('upgrade025admin','fixture') RETURNING id::text AS id")).rows[0].id;
  await client.query("INSERT INTO academic_years(name) VALUES('2026/2027')");

  const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name", [schema])).rows.map((r) => r.table_name);
  const before = await snapshot(tables);
  const sequences = (await client.query('SELECT sequencename,last_value FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename', [schema])).rows;

  await client.query(await readFile(join(root, 'migrations', '025_app_settings.sql'), 'utf8'));

  assert.deepEqual(await snapshot(tables), before, 'Seluruh tabel sebelum 025 harus tetap identik.');
  const afterSequences = (await client.query('SELECT sequencename,last_value FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename', [schema])).rows;
  for (const row of sequences) assert.deepEqual(afterSequences.find((x) => x.sequencename === row.sequencename), row);

  const row = (await client.query('SELECT id, app_name, school_name, color_palette, revision FROM app_settings WHERE id = 1')).rows[0];
  assert.equal(row.id, 1);
  assert.equal(row.app_name, 'NusaCBT');
  assert.equal(row.school_name, '');
  assert.equal(row.color_palette, 'emerald');
  assert.equal(row.revision, '1');

  await client.query("UPDATE app_settings SET school_name = 'SMA Uji', updated_by = $1, revision = revision + 1 WHERE id = 1", [admin]);
  await rejects("INSERT INTO app_settings(id, app_name) VALUES(2, 'Lain')", [], ['23514']);
  await rejects("UPDATE app_settings SET color_palette = 'invalid' WHERE id = 1", [], ['23514']);
  await rejects("UPDATE app_settings SET logo_image = '\\x01' WHERE id = 1", [], ['23514']);

  console.log(`Upgrade 024→025 lulus: ${tables.length} tabel lama dan ${sequences.length} sequence identik; singleton app_settings terpasang dan tervalidasi.`);
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end().catch(() => {});
}
