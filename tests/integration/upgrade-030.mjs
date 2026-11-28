// Upgrade 029 -> 030 memakai skema sementara di dalam database uji.
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
const schema = `upgrade_030_${randomBytes(6).toString("hex")}`;
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
  const old = files.filter((x) => Number(x.slice(0, 3)) <= 29);
  assert.equal(old.length, 29);
  for (const file of old) await client.query(await readFile(join(root, "migrations", file), "utf8"));

  const tables = (await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",
    [schema],
  )).rows.map((r) => r.table_name);
  const before = await snapshot(tables);

  await client.query(await readFile(join(root, "migrations", "030_global_token_auto_rotate.sql"), "utf8"));

  assert.deepEqual(await snapshot(tables), before, "Seluruh 51 tabel pra-030 tetap identik.");

  const row = (await client.query("SELECT id, enabled, duration_minutes FROM global_token_auto_rotate")).rows[0];
  assert.deepEqual(row, { id: 1, enabled: false, duration_minutes: 15 });

  await rejects("INSERT INTO global_token_auto_rotate(id, enabled, duration_minutes) VALUES(2, false, 15)", [], ["23514"]);
  await rejects("UPDATE global_token_auto_rotate SET duration_minutes = 7 WHERE id = 1", [], ["23514"]);
  await rejects("UPDATE global_token_auto_rotate SET updated_by_admin_id = 999999 WHERE id = 1", [], ["23503"]);

  await client.query("ROLLBACK");
  console.log("OK upgrade-030");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
