// Upgrade 025 -> 026 memakai skema sementara di dalam database uji.
// Seluruh DDL dan fixture dibatalkan pada akhir transaksi; database lain tidak disentuh.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ADMIN_PERMISSION_KEYS } from '../../src/lib/admin-permissions.mjs';
import { postgresConfig } from '../../src/lib/postgres-config.mjs';

if (process.env.PGDATABASE !== 'nusacbt_test' || process.env.NUSACBT_CONFIRM_TEST_DATABASE !== 'nusacbt_test') {
  throw new Error('Wajib database terisolasi nusacbt_test dan NUSACBT_CONFIRM_TEST_DATABASE=nusacbt_test.');
}
const root = fileURLToPath(new URL('../..', import.meta.url));
const schema = `upgrade_026_${randomBytes(6).toString('hex')}`;
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
  const old = files.filter((x) => Number(x.slice(0, 3)) <= 25);
  assert.equal(old.length, 25);
  for (const file of old) await client.query(await readFile(join(root, 'migrations', file), 'utf8'));

  const legacyAdmin = (await client.query(
    "INSERT INTO admin_users(username,password_hash) VALUES('upgrade026admin','fixture_hash') RETURNING id::text AS id",
  )).rows[0].id;
  await client.query("INSERT INTO academic_years(name) VALUES('2026/2027')");
  await client.query("UPDATE app_settings SET school_name = 'SMA Upgrade 026', revision = revision + 1 WHERE id = 1");

  const tables = (await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",
    [schema],
  )).rows.map((r) => r.table_name);
  const unchangedTables = tables.filter((t) => t !== 'admin_users');
  const before = await snapshot(unchangedTables);
  const sequences = (await client.query('SELECT sequencename,last_value FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename', [schema])).rows;

  await client.query(await readFile(join(root, 'migrations', '026_admin_users_rbac.sql'), 'utf8'));

  assert.deepEqual(await snapshot(unchangedTables), before, 'Tabel sebelum 026 selain admin_users harus tetap identik.');
  const afterSequences = (await client.query('SELECT sequencename,last_value FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename', [schema])).rows;
  for (const row of sequences) assert.deepEqual(afterSequences.find((x) => x.sequencename === row.sequencename), row);

  // Admin lama sebelum 026 dipertahankan sebagai Superadmin aktif dengan full_name terisi.
  const upgradedAdmin = (await client.query(
    'SELECT username, full_name, is_superuser, is_active, role_id, password_hash FROM admin_users WHERE id = $1::bigint',
    [legacyAdmin],
  )).rows[0];
  assert.deepEqual(upgradedAdmin, {
    username: 'upgrade026admin',
    full_name: 'upgrade026admin',
    is_superuser: true,
    is_active: true,
    role_id: null,
    password_hash: 'fixture_hash',
  });

  // Periksa 3 peran bawaan sistem & izin awalnya.
  const rolesRes = await client.query(
    `SELECT r.id::text AS id, r.slug, r.is_system, r.revision::int AS revision,
       COALESCE(ARRAY(SELECT rp.permission_key FROM admin_role_permissions rp WHERE rp.role_id = r.id ORDER BY rp.permission_key), '{}'::text[]) AS perms
     FROM admin_roles r ORDER BY r.slug`,
  );
  assert.deepEqual(rolesRes.rows.map((r) => r.slug), ['operator_ujian', 'pembuat_soal', 'pengawas']);
  assert.deepEqual(rolesRes.rows.find((r) => r.slug === 'operator_ujian').perms, [
    'exams.manage',
    'monitoring.view',
    'participant_accounts.manage',
    'participant_cards.print',
    'tokens.manage',
  ]);
  assert.deepEqual(rolesRes.rows.find((r) => r.slug === 'pembuat_soal').perms, [
    'questions.export',
    'questions.import',
    'questions.manage',
    'topics.manage',
  ]);
  assert.deepEqual(rolesRes.rows.find((r) => r.slug === 'pengawas').perms, [
    'monitoring.view',
    'participant_cards.print',
    'reports.view',
    'tokens.manage',
  ]);

  // Seluruh 21 kode izin valid harus diterima constraint CHECK.
  const customRoleId = (await client.query(
    "INSERT INTO admin_roles(slug, name, description, updated_by) VALUES('semua_izin', 'Semua Izin', 'Tes 21 izin', $1::bigint) RETURNING id::text AS id",
    [legacyAdmin],
  )).rows[0].id;
  for (const key of ADMIN_PERMISSION_KEYS) {
    await client.query('INSERT INTO admin_role_permissions(role_id, permission_key) VALUES($1::bigint, $2)', [customRoleId, key]);
  }

  // Operator baru dengan role terpasang mencegah penghapusan role (ON DELETE RESTRICT).
  await client.query(
    "INSERT INTO admin_users(username, full_name, password_hash, is_superuser, is_active, role_id) VALUES('op_terikat', 'Operator Terikat', 'hash', false, true, $1::bigint)",
    [customRoleId],
  );
  await rejects('DELETE FROM admin_roles WHERE id = $1::bigint', [customRoleId], ['23503', '23001']);

  // Validasi constraint unik case-insensitive & CHECK.
  await rejects("INSERT INTO admin_roles(slug, name) VALUES('dup', '  SEMUA IZIN  ')", [], ['23505']);
  await rejects("INSERT INTO admin_roles(slug, name) VALUES('bad', '   ')", [], ['23514']);
  await rejects("INSERT INTO admin_role_permissions(role_id, permission_key) VALUES($1::bigint, 'unknown.perm')", [customRoleId], ['23514']);
  await rejects("INSERT INTO admin_users(username, full_name, password_hash) VALUES('bad_ctrl', E'Nama\\x07', 'hash')", [], ['23514']);
  await rejects("INSERT INTO admin_user_audit(target_username_snapshot, actor_username_snapshot, event) VALUES('a', 'b', 'unknown_event')", [], ['23514']);

  console.log(`Upgrade 025→026 lulus: ${unchangedTables.length} tabel lama & ${sequences.length} sequence identik; RBAC (21 izin, 3 peran bawaan, audit, & superadmin lama) terpasang.`);
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end().catch(() => {});
}
