// Upgrade 028 -> 029 memakai skema sementara di dalam database uji.
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
const schema = `upgrade_029_${randomBytes(6).toString("hex")}`;
const client = new pg.Client(postgresConfig());
const quote = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error("Identifier uji tidak valid");
  return `"${s}"`;
};

async function snapshot(tables) {
  const out = {};
  for (const table of tables) {
    const expr = table === "app_settings"
      ? "(to_jsonb(r)-'default_time_zone'-'timeline_default_days'-'letterhead_image'-'letterhead_image_mime')"
      : table === "exam_tests"
        ? "(to_jsonb(r)-'tags'-'tags_signature')"
        : table === "question_topics"
          ? "(to_jsonb(r)-'tags'-'tags_signature')"
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
  const old = files.filter((x) => Number(x.slice(0, 3)) <= 28);
  assert.equal(old.length, 28);
  for (const file of old) await client.query(await readFile(join(root, "migrations", file), "utf8"));

  // Seed data pra-029 termasuk kolom app_settings lama, tag topik tak berurutan, dan exam_tests lama
  const yearId = (await client.query("INSERT INTO academic_years(name) VALUES('2026/2027') RETURNING id")).rows[0].id;
  const periodId = (
    await client.query(
      "INSERT INTO exam_periods(name,start_date,end_date,academic_year_id,is_active) VALUES('PAS Ganjil','2026-11-01','2026-11-10',$1,true) RETURNING id",
      [yearId],
    )
  ).rows[0].id;
  await client.query(
    "UPDATE app_settings SET timeline_default_days = 3, letterhead_image = $1, letterhead_image_mime = 'image/png' WHERE id = 1",
    [Buffer.from([137, 80, 78, 71])],
  );
  const topicId = (
    await client.query(
      "INSERT INTO question_topics(name, tags, tags_signature) VALUES('Fisika', ARRAY['X', 'Ganjil', '2026'], '2026\u001fganjil\u001fx') RETURNING id",
    )
  ).rows[0].id;
  const testId = (
    await client.query(
      "INSERT INTO exam_tests(period_id, name, starts_at, time_zone, duration_minutes) VALUES($1, 'PAS Fisika', '2026-11-02 01:00:00+00', 'WIB', 90) RETURNING id",
      [periodId],
    )
  ).rows[0].id;

  const tables = (await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",
    [schema],
  )).rows.map((r) => r.table_name);
  const before = await snapshot(tables);

  await client.query(await readFile(join(root, "migrations", "029_revisi_platform_030.sql"), "utf8"));

  assert.deepEqual(await snapshot(tables), before, "Seluruh 51 tabel tetap identik pada kolom pra-029.");

  // Verifikasi kolom app_settings baru & kolom lama yang dihapus
  const cols = (
    await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='app_settings'",
      [schema],
    )
  ).rows.map((r) => r.column_name);
  assert.ok(cols.includes("default_time_zone"));
  assert.ok(!cols.includes("timeline_default_days"));
  assert.ok(!cols.includes("letterhead_image"));
  assert.ok(!cols.includes("letterhead_image_mime"));

  const settings = (await client.query("SELECT default_time_zone FROM app_settings WHERE id = 1")).rows[0];
  assert.equal(settings.default_time_zone, "WIB");
  await rejects("UPDATE app_settings SET default_time_zone = 'UTC' WHERE id = 1", [], ["23514"]);
  await client.query("UPDATE app_settings SET default_time_zone = 'WITA' WHERE id = 1");

  // Verifikasi pengurutan tag topik yang sudah ada secara alfabetis
  const topic = (await client.query("SELECT tags, tags_signature FROM question_topics WHERE id = $1", [topicId])).rows[0];
  assert.deepEqual(topic.tags, ["2026", "Ganjil", "X"]);
  assert.equal(topic.tags_signature, "2026\u001fganjil\u001fx");

  // Verifikasi kolom tags pada exam_tests beserta batasan check
  const testRow = (await client.query("SELECT tags, tags_signature FROM exam_tests WHERE id = $1", [testId])).rows[0];
  assert.deepEqual(testRow.tags, []);
  assert.equal(testRow.tags_signature, "");
  await client.query(
    "UPDATE exam_tests SET tags = ARRAY['2026', 'Kelas X'], tags_signature = '2026\u001fkelas x' WHERE id = $1",
    [testId],
  );
  await rejects("UPDATE exam_tests SET tags = ARRAY[''] WHERE id = $1", [testId], ["23514"]);
  await rejects(
    "UPDATE exam_tests SET tags = ARRAY['1','2','3','4','5','6','7','8','9','10','11'] WHERE id = $1",
    [testId],
    ["23514"],
  );

  await client.query("ROLLBACK");
  console.log("OK upgrade-029");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
