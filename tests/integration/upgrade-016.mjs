// Upgrade 015 -> 016 hanya pada DATABASE KOSONG khusus tes. Tidak membuat atau
// menghapus database. Menolak nama, konfirmasi, encoding, atau isi yang salah.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";

import { participantAttemptBucket, participantSessionDigest } from "../../src/lib/participant-login-validation.mjs";
import { decryptParticipantPassword, participantKeyVerifier } from "../../src/lib/participant-password-crypto.mjs";
import { hashPassword, verifyPassword } from "../../src/lib/password.mjs";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";

const database = "nusacbt_upgrade_016_test";
if (process.env.PGDATABASE !== database || process.env.NUSACBT_CONFIRM_TEST_DATABASE !== database) {
  throw new Error(`Wajib memakai PGDATABASE=${database} dan NUSACBT_CONFIRM_TEST_DATABASE=${database}; gunakan database kosong khusus uji.`);
}
const root = fileURLToPath(new URL("../..", import.meta.url));
const vectorFile = JSON.parse(await readFile(new URL("../fixtures/participant-password-v014.json", import.meta.url), "utf8"));
const vector = vectorFile.vectors[0];
const key = Buffer.from(vectorFile.key, "base64");
const client = new pg.Client(postgresConfig());

function identifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Identifier uji tidak valid.");
  return `"${value}"`;
}

async function snapshot(tables, sequences) {
  const result = {};
  for (const table of tables) {
    const object = table === "exam_periods"
      ? "(to_jsonb(r)-'academic_year_id')"
      : table === "admin_users"
        ? "(to_jsonb(r)-'full_name'-'is_superuser'-'is_active'-'role_id'-'updated_at'-'last_login_at')"
        : "to_jsonb(r)";
    const rows = await client.query(`SELECT COALESCE(jsonb_agg(${object} ORDER BY ${object}::text),'[]'::jsonb) AS rows FROM ${identifier(table)} r`);
    result[`table:${table}`] = createHash("sha256").update(JSON.stringify(rows.rows[0].rows)).digest("hex");
  }
  const states = (await client.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
  for (const sequence of sequences) result[`sequence:${sequence}`] = states.find((row) => row.sequencename === sequence)?.last_value ?? null;
  return result;
}

try {
  await client.connect();
  assert.equal((await client.query("SELECT current_database() AS name")).rows[0].name, database);
  assert.equal((await client.query("SHOW server_encoding")).rows[0].server_encoding, "UTF8");
  const existing = await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1");
  if (existing.rowCount) throw new Error("Database uji tidak kosong; tidak ada perubahan yang dilakukan.");
  const files = (await readdir(join(root, "migrations"))).filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file)).sort();
  const oldFiles = files.filter((file) => Number(file.slice(0, 3)) <= 15);
  assert.equal(oldFiles.length, 15);
  assert.ok(files.includes("016_participant_login_unlock.sql"));
  await client.query("CREATE TABLE nusacbt_schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const file of oldFiles) {
    const sql = (await readFile(join(root, "migrations", file), "utf8")).replace(/\r\n/g, "\n");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await client.query("BEGIN");
    try { await client.query(sql); await client.query("INSERT INTO nusacbt_schema_migrations(version,checksum) VALUES($1,$2)", [file, checksum]); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  }

  // Fixture seluruhnya fiktif, termasuk sandi lama, sesi, audit dan pembatas.
  const adminHash = await hashPassword("Admin-Upgrade-016-Fiktif!");
  const session = randomBytes(32).toString("base64url");
  await client.query("BEGIN");
  try {
    const adminId = (await client.query("INSERT INTO admin_users(username,password_hash) VALUES('admin_upgrade_016',$1) RETURNING id", [adminHash])).rows[0].id;
    const majorId = (await client.query("INSERT INTO school_majors(name) VALUES('JURUSAN UJI 016') RETURNING id")).rows[0].id;
    const classId = (await client.query("INSERT INTO school_classes(level,major_id) VALUES('X',$1) RETURNING id", [majorId])).rows[0].id;
    await client.query("INSERT INTO exam_periods(id,name,start_date,end_date) OVERRIDING SYSTEM VALUE VALUES(19,'Periode Uji 016','2025-01-01','2025-12-31')");
    await client.query("SELECT setval(pg_get_serial_sequence('exam_periods','id'),19,true)");
    const studentId = (await client.query("INSERT INTO school_students(name,nisn) VALUES('Siswa Fiktif 🧪','0123456789') RETURNING id")).rows[0].id;
    const placementId = (await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,19,$2,'X JURUSAN UJI 016') RETURNING id", [studentId, classId])).rows[0].id;
    await client.query("INSERT INTO participant_identities(id,student_id,period_id,participant_number,username) OVERRIDING SYSTEM VALUE VALUES(42,$1,19,'FIKTIF-042','MiX.Fiktif_042')", [studentId]);
    await client.query("SELECT setval(pg_get_serial_sequence('participant_identities','id'),42,true)");
    await client.query("INSERT INTO participant_password_key_binding(id,verifier) VALUES(1,$1)", [participantKeyVerifier(key)]);
    await client.query("INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES(42,$1,$2,$3,$4)", [vector.hash, Buffer.from(vector.nonce, "base64"), Buffer.from(vector.ciphertext, "base64"), Buffer.from(vector.authenticationTag, "base64")]);
    for (const event of ["create_manual", "create_auto", "reset_manual", "reset_auto", "reveal"]) await client.query("INSERT INTO participant_password_audit(participant_identity_id,admin_id,event) VALUES(42,$1,$2)", [adminId, event]);
    await client.query("UPDATE participant_login_settings SET period_id=19 WHERE id=1");
    await client.query("UPDATE participant_login_global_limit SET attempts=73,window_started_at=clock_timestamp() WHERE id=1");
    await client.query("INSERT INTO participant_login_attempts(bucket_hash,failed_attempts,locked_until) VALUES($1,5,clock_timestamp()+interval '15 minutes'),($2,2,NULL)", [participantAttemptBucket("19", "mix.fiktif_042"), participantAttemptBucket("19", "lainnya")]);
    await client.query(`INSERT INTO participant_sessions(token_hash,participant_identity_id,placement_id,username_snapshot,identity_revision,password_revision,password_hash_digest,expires_at)
      SELECT $1,i.id,$2,i.username,i.updated_at,pw.updated_at,sha256(convert_to(pw.password_hash,'UTF8')),clock_timestamp()+interval '8 hours'
      FROM participant_identities i JOIN participant_passwords pw ON pw.participant_identity_id=i.id WHERE i.id=42`, [participantSessionDigest(session), placementId]);
    await client.query("INSERT INTO question_topics(name) VALUES('Topik ما قيمة √٤؟ 🧪')");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }

  // Pastikan implementasi SQL untuk daftar kunci sama dengan digest login Node.
  const prefix = Buffer.from("NusaCBT participant login v1\0", "utf8");
  for (const [period, username] of [["19", "MiX.Fiktif_042"], ["1", "ABC.xyz_09-"], ["9223372036854775807", "Z".repeat(64)]]) {
    const sql = (await client.query("SELECT sha256($1::bytea||convert_to($2::text,'UTF8')||decode('00','hex')||convert_to(lower($3::text COLLATE \"C\"),'UTF8')) AS hash", [prefix, period, username])).rows[0].hash;
    assert.deepEqual(sql, participantAttemptBucket(period, username.toLowerCase()));
  }

  const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT IN ('nusacbt_schema_migrations','participant_login_settings','participant_sessions') ORDER BY table_name")).rows.map((row) => row.table_name);
  const sequences = (await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows.map((row) => row.sequencename);
  const before = await snapshot(tables, sequences);
  const history = (await client.query("SELECT version,checksum,applied_at FROM nusacbt_schema_migrations ORDER BY version")).rows;
  for (let run = 0; run < 2; run += 1) {
    const result = spawnSync(process.execPath, [join(root, "scripts/migrate.mjs")], { cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, encoding: "utf8" });
    assert.equal(result.status, 0, `Migrasi uji gagal: ${result.stderr}`);
  }
  assert.deepEqual(await snapshot(tables, sequences), before);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM admin_users WHERE NOT (is_superuser AND is_active AND full_name = username AND role_id IS NULL)")).rows[0].n, 0);
  const afterHistory = (await client.query("SELECT version,checksum,applied_at FROM nusacbt_schema_migrations ORDER BY version")).rows;
  assert.deepEqual(afterHistory.slice(0, 15), history);
  assert.equal(afterHistory.length, files.length);
  assert.equal(afterHistory[15].version, "016_participant_login_unlock.sql");
  const stored = (await client.query("SELECT password_hash AS hash,nonce,ciphertext,authentication_tag AS \"authenticationTag\" FROM participant_passwords WHERE participant_identity_id=42")).rows[0];
  assert.equal(await verifyPassword(vector.password, stored.hash), true);
  assert.equal(decryptParticipantPassword(stored, key, vectorFile.binding), vector.password);
  assert.equal((await client.query("SELECT period_id FROM participant_login_settings WHERE id=1")).rows[0].period_id, null);
  assert.equal((await client.query("SELECT 1 FROM participant_sessions WHERE token_hash=$1", [participantSessionDigest(session)])).rowCount, 0);
  assert.equal((await client.query("SELECT 1 FROM exam_periods WHERE academic_year_id IS NOT NULL")).rowCount, 0);
  assert.equal((await client.query("SELECT attempts FROM participant_login_global_limit WHERE id=1")).rows[0].attempts, 73);
  assert.equal((await client.query("SELECT failed_attempts FROM participant_login_attempts WHERE bucket_hash=$1 AND locked_until>clock_timestamp()", [participantAttemptBucket("19", "mix.fiktif_042")])).rows[0].failed_attempts, 5);

  // Periksa constraint baru dan batas nilai lain, lalu rollback tanpa mengubah sequence.
  await client.query("BEGIN");
  try {
    const adminId = (await client.query("SELECT id FROM admin_users WHERE username='admin_upgrade_016'")).rows[0].id;
    await client.query("INSERT INTO participant_password_audit(id,participant_identity_id,admin_id,event) OVERRIDING SYSTEM VALUE VALUES(9999991,42,$1,'unlock_login')", [adminId]);
    await client.query("SAVEPOINT bad_event");
    await assert.rejects(client.query("INSERT INTO participant_password_audit(id,participant_identity_id,admin_id,event) OVERRIDING SYSTEM VALUE VALUES(9999992,42,$1,'invalid_event')", [adminId]), { code: "23514" });
    await client.query("ROLLBACK TO SAVEPOINT bad_event");
  } finally { await client.query("ROLLBACK"); }
  assert.deepEqual(await snapshot(tables, sequences), before);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM exam_schedule_runs")).rows[0].n, 0);
  console.log(`Migrasi 015 → terbaru (016–023) dua kali: ${tables.length} tabel dan ${sequences.length} sequence identik; periode aktif, sesi, audit, sandi lama, kunci, dan pembatas tetap utuh.`);
  console.log("Constraint audit menerima unlock_login, menolak event lain; digest SQL/Node identik pada tiga vektor.");
} finally { key.fill(0); await client.end().catch(() => {}); }
