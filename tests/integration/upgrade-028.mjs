// Upgrade 027 -> 028 memakai skema sementara di dalam database uji.
// Seluruh DDL dan fixture dibatalkan pada akhir transaksi; database lain tidak disentuh.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";

if (process.env.PGDATABASE !== "nusacbt_test" || process.env.NUSACBT_CONFIRM_TEST_DATABASE !== "nusacbt_test") {
  throw new Error("Wajib database terisolasi nusacbt_test dan NUSACBT_CONFIRM_TEST_DATABASE=nusacbt_test.");
}
const root = fileURLToPath(new URL("../..", import.meta.url));
const schema = `upgrade_028_${randomBytes(6).toString("hex")}`;
const client = new pg.Client(postgresConfig());
const quote = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error("Identifier uji tidak valid");
  return `"${s}"`;
};

async function snapshot(tables) {
  const out = {};
  for (const table of tables) {
    const expr = table === "app_settings"
      ? "(to_jsonb(r)-'app_mode'-'timeline_default_days')"
      : table === "question_topics"
        ? "(to_jsonb(r)-'tags'-'tags_signature')"
        : table === "exam_periods"
          ? "(to_jsonb(r)-'is_active')"
          : "to_jsonb(r)";
    const data = await client.query(
      `SELECT COALESCE(jsonb_agg(${expr} ORDER BY ${expr}::text),'[]'::jsonb) AS rows FROM ${quote(table)} r`,
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
  const old = files.filter((x) => Number(x.slice(0, 3)) <= 27);
  assert.equal(old.length, 27);
  for (const file of old) await client.query(await readFile(join(root, "migrations", file), "utf8"));

  const yearId = (await client.query("INSERT INTO academic_years(name) VALUES('2026/2027') RETURNING id")).rows[0].id;
  const p1 = (await client.query("INSERT INTO exam_periods(name,start_date,end_date,academic_year_id) VALUES('UTS Ganjil','2026-10-01','2026-10-07',$1) RETURNING id", [yearId])).rows[0].id;
  const p2 = (await client.query("INSERT INTO exam_periods(name,start_date,end_date,academic_year_id) VALUES('UTS Susulan','2026-10-08','2026-10-12',$1) RETURNING id", [yearId])).rows[0].id;
  await client.query("UPDATE participant_login_settings SET period_id = $1 WHERE id = 1", [p1]);
  await client.query("INSERT INTO question_topics(name) VALUES('Matematika')");

  const tables = (await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",
    [schema],
  )).rows.map((r) => r.table_name);
  const before = await snapshot(tables);

  await client.query(await readFile(join(root, "migrations", "028_platform_revisions.sql"), "utf8"));

  assert.deepEqual(await snapshot(tables), before, "Seluruh 51 tabel lama tetap identik pada kolom pra-028.");

  const settings = (await client.query("SELECT app_mode, timeline_default_days FROM app_settings WHERE id = 1")).rows[0];
  assert.equal(settings.app_mode, "production");
  assert.equal(settings.timeline_default_days, 7);

  const periods = (await client.query("SELECT id, is_active FROM exam_periods ORDER BY id")).rows;
  assert.equal(periods.find((p) => p.id === p1).is_active, true, "Periode login sebelumnya otomatis backfill menjadi is_active=true");
  assert.equal(periods.find((p) => p.id === p2).is_active, false);

  // Nama mapel sama diizinkan jika tag berbeda, ditolak jika nama+tag persis sama.
  await client.query(
    "INSERT INTO question_topics(name, tags, tags_signature) VALUES('Matematika', ARRAY['2026/2027', 'X', 'ganjil'], '2026/2027\u001fganjil\u001fx')",
  );
  await rejects(
    "INSERT INTO question_topics(name, tags, tags_signature) VALUES('matematika', ARRAY['2026/2027', 'X', 'ganjil'], '2026/2027\u001fganjil\u001fx')",
    [],
    ["23505"],
  );
  await rejects("UPDATE app_settings SET app_mode = 'staging' WHERE id = 1", [], ["23514"]);
  await rejects("UPDATE app_settings SET timeline_default_days = 8 WHERE id = 1", [], ["23514"]);
  await rejects("UPDATE app_settings SET timeline_default_days = 0 WHERE id = 1", [], ["23514"]);
  await rejects("INSERT INTO question_topics(name, tags, tags_signature) VALUES('Kimia', ARRAY[''], '')", [], ["23514"]);

  await client.query("ROLLBACK");
  console.log(`Upgrade 027→028 lulus: ${tables.length} tabel identik, mode dev/production, tag mapel unik (nama+tag), & multi-periode backfill teruji.`);
} finally {
  await client.end().catch(() => {});
}
