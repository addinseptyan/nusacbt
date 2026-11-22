// Upgrade 017 -> terbaru hanya pada database kosong khusus tes. Tidak membuat,
// menghapus, atau menimpa database. Semua isi/kunci/sesi dalam fixture fiktif.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";

import { decryptSixDigitToken, digestSixDigitToken, encryptSixDigitToken, examTokenKeyVerifier } from "../../src/lib/exam-token-crypto.mjs";
import { participantSessionDigest } from "../../src/lib/participant-login-validation.mjs";
import { decryptParticipantPassword, participantKeyVerifier } from "../../src/lib/participant-password-crypto.mjs";
import { hashPassword, verifyPassword } from "../../src/lib/password.mjs";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";

const database = "nusacbt_upgrade_018_test";
if (process.env.PGDATABASE !== database || process.env.NUSACBT_CONFIRM_TEST_DATABASE !== database) {
  throw new Error(`Wajib memakai PGDATABASE=${database} dan NUSACBT_CONFIRM_TEST_DATABASE=${database}; gunakan database kosong khusus uji.`);
}
const root = fileURLToPath(new URL("../..", import.meta.url));
const vectorFile = JSON.parse(await readFile(new URL("../fixtures/participant-password-v014.json", import.meta.url), "utf8"));
const vector = vectorFile.vectors[0]; const key = Buffer.from(vectorFile.key, "base64");
const tokenKey = Buffer.alloc(32, 93); const client = new pg.Client(postgresConfig());
function identifier(value) { if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Identifier tidak valid."); return `"${value}"`; }
async function snapshot(tables, sequences) {
  const result = {};
  for (const table of tables) {
    const object = table === "exam_periods" ? "(to_jsonb(r)-'academic_year_id')" : "to_jsonb(r)";
    const rows = await client.query(`SELECT COALESCE(jsonb_agg(${object} ORDER BY ${object}::text),'[]'::jsonb) AS rows FROM ${identifier(table)} r`);
    result[`table:${table}`] = createHash("sha256").update(JSON.stringify(rows.rows[0].rows)).digest("hex");
  }
  const states = (await client.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
  for (const sequence of sequences) result[`sequence:${sequence}`] = states.find((row) => row.sequencename === sequence)?.last_value ?? null;
  return result;
}
async function rejectedAt(savepoint, sql, params, codes) {
  await client.query(`SAVEPOINT ${identifier(savepoint)}`);
  await assert.rejects(client.query(sql, params), (error) => codes.includes(error.code), `Constraint ${savepoint} tidak menolak perubahan.`);
  await client.query(`ROLLBACK TO SAVEPOINT ${identifier(savepoint)}`);
}

try {
  await client.connect();
  assert.equal((await client.query("SELECT current_database() AS name")).rows[0].name, database);
  assert.equal((await client.query("SHOW server_encoding")).rows[0].server_encoding, "UTF8");
  const existing = await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1");
  if (existing.rowCount) throw new Error("Database uji tidak kosong; tidak ada perubahan yang dilakukan.");
  const files = (await readdir(join(root, "migrations"))).filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file)).sort();
  const oldFiles = files.filter((file) => Number(file.slice(0, 3)) <= 17);
  assert.equal(oldFiles.length, 17); assert.ok(files.includes("018_exam_attempts.sql"));
  await client.query("CREATE TABLE nusacbt_schema_migrations (version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
  for (const file of oldFiles) {
    const sql = (await readFile(join(root, "migrations", file), "utf8")).replace(/\r\n/g, "\n");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await client.query("BEGIN");
    try { await client.query(sql); await client.query("INSERT INTO nusacbt_schema_migrations(version,checksum) VALUES($1,$2)", [file, checksum]); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  }

  const adminHash = await hashPassword("Admin-Upgrade-018-Fiktif!");
  const session = randomBytes(32).toString("base64url");
  let adminId, studentId, placementId, questionId, examId, runId;
  await client.query("BEGIN");
  try {
    adminId = (await client.query("INSERT INTO admin_users(username,password_hash) VALUES('admin_upgrade_018',$1) RETURNING id", [adminHash])).rows[0].id;
    const major = (await client.query("INSERT INTO school_majors(name) VALUES('JURUSAN UJI 018') RETURNING id")).rows[0].id;
    const schoolClass = (await client.query("INSERT INTO school_classes(level,major_id) VALUES('X',$1) RETURNING id", [major])).rows[0].id;
    await client.query("INSERT INTO exam_periods(id,name,start_date,end_date) OVERRIDING SYSTEM VALUE VALUES(19,'Periode 018','2025-01-01','2028-12-31')");
    await client.query("SELECT setval(pg_get_serial_sequence('exam_periods','id'),19,true)");
    studentId = (await client.query("INSERT INTO school_students(name,nisn) VALUES('Siswa Fiktif 🧪','0123456789') RETURNING id")).rows[0].id;
    placementId = (await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,19,$2,'X JURUSAN UJI 018') RETURNING id", [studentId, schoolClass])).rows[0].id;
    await client.query("INSERT INTO participant_identities(id,student_id,period_id,participant_number,username) OVERRIDING SYSTEM VALUE VALUES(42,$1,19,'FIKTIF-042','MiX.Fiktif_042')", [studentId]);
    await client.query("SELECT setval(pg_get_serial_sequence('participant_identities','id'),42,true)");
    await client.query("INSERT INTO participant_password_key_binding(id,verifier) VALUES(1,$1)", [participantKeyVerifier(key)]);
    await client.query("INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES(42,$1,$2,$3,$4)", [vector.hash, Buffer.from(vector.nonce, "base64"), Buffer.from(vector.ciphertext, "base64"), Buffer.from(vector.authenticationTag, "base64")]);
    await client.query("INSERT INTO participant_password_audit(participant_identity_id,admin_id,event) VALUES(42,$1,'create_manual')", [adminId]);
    await client.query("UPDATE participant_login_settings SET period_id=19 WHERE id=1");
    await client.query(`INSERT INTO participant_sessions(token_hash,participant_identity_id,placement_id,username_snapshot,identity_revision,password_revision,password_hash_digest,expires_at)
      SELECT $1,i.id,$2,i.username,i.updated_at,pw.updated_at,sha256(convert_to(pw.password_hash,'UTF8')),clock_timestamp()+interval '8 hours'
      FROM participant_identities i JOIN participant_passwords pw ON pw.participant_identity_id=i.id WHERE i.id=42`, [participantSessionDigest(session), placementId]);
    const topic = (await client.query("INSERT INTO question_topics(name) VALUES('Topik العربية 🧪') RETURNING id")).rows[0].id;
    questionId = (await client.query(`INSERT INTO question_bank(topic_id,prompt_text,option_a_text,option_b_text,option_c_text,option_d_text,option_e_text,correct_option)
      VALUES($1,'Soal lama 🧪','A','B','C','D','E','A') RETURNING id`, [topic])).rows[0].id;
    examId = (await client.query(`INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes,shuffle_questions,shuffle_options)
      VALUES(19,'Tes Lama Fiktif',clock_timestamp()-interval '5 minutes','WIB',60,true,true) RETURNING id`)).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)", [examId, questionId]);
    await client.query("INSERT INTO exam_session_plans(period_id,revision,updated_by) VALUES(19,4,$1)", [adminId]);
    await client.query("INSERT INTO exam_session_groups(period_id,session_number,capacity) VALUES(19,1,30)");
    await client.query("INSERT INTO exam_session_assignments(period_id,student_id,session_number,placement_id) VALUES(19,$1,1,$2)", [studentId, placementId]);
    runId = (await client.query(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,session_number,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
      VALUES($1,19,'regular','Sesi lama',1,clock_timestamp()-interval '5 minutes','WIB',60,$2,clock_timestamp(),$2) RETURNING id`, [examId, adminId])).rows[0].id;
    await client.query("INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id) VALUES($1,$2,19,'regular',$3,$4)", [runId, examId, studentId, placementId]);
    await client.query("INSERT INTO exam_token_key_binding(id,verifier) VALUES(1,$1)", [examTokenKeyVerifier(tokenKey)]);
    const tokenId = (await client.query("SELECT nextval(pg_get_serial_sequence('exam_access_tokens','id'))::text AS id")).rows[0].id;
    const code = "654321", encrypted = encryptSixDigitToken(code, tokenKey, { id: tokenId, scope: "test" });
    await client.query(`WITH m AS (SELECT clock_timestamp() AS issued)
      INSERT INTO exam_access_tokens(id,scope,exam_test_id,test_name_snapshot,token_hash,duration_minutes,issued_at,expires_at,code_version,code_nonce,code_ciphertext,code_tag)
      OVERRIDING SYSTEM VALUE SELECT $1,'test',$2,'Tes Lama Fiktif',$3,15,issued,issued+interval '15 minutes',2,$4,$5,$6 FROM m`,
      [tokenId, examId, digestSixDigitToken(code, tokenKey), encrypted.nonce, encrypted.ciphertext, encrypted.tag]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }

  const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT IN ('nusacbt_schema_migrations','participant_login_settings','participant_sessions') ORDER BY table_name")).rows.map((row) => row.table_name);
  const sequences = (await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows.map((row) => row.sequencename);
  const before = await snapshot(tables, sequences);
  const history = (await client.query("SELECT version,checksum,applied_at FROM nusacbt_schema_migrations ORDER BY version")).rows;
  for (let run = 0; run < 2; run += 1) {
    const result = spawnSync(process.execPath, [join(root, "scripts/migrate.mjs")], { cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, encoding: "utf8" });
    assert.equal(result.status, 0, `Migrasi uji gagal: ${result.stderr}`);
  }
  assert.deepEqual(await snapshot(tables, sequences), before);
  const afterHistory = (await client.query("SELECT version,checksum,applied_at FROM nusacbt_schema_migrations ORDER BY version")).rows;
  assert.deepEqual(afterHistory.slice(0, 17), history); assert.equal(afterHistory.length, files.length);
  assert.equal(afterHistory[17].version, "018_exam_attempts.sql");
  const stored = (await client.query('SELECT password_hash AS hash,nonce,ciphertext,authentication_tag AS "authenticationTag" FROM participant_passwords WHERE participant_identity_id=42')).rows[0];
  assert.equal(await verifyPassword(vector.password, stored.hash), true);
  assert.equal(decryptParticipantPassword(stored, key, vectorFile.binding), vector.password);
  assert.equal((await client.query("SELECT period_id FROM participant_login_settings WHERE id=1")).rows[0].period_id, null);
  assert.equal((await client.query("SELECT 1 FROM participant_sessions WHERE token_hash=$1", [participantSessionDigest(session)])).rowCount, 0);
  assert.equal((await client.query("SELECT 1 FROM exam_periods WHERE academic_year_id IS NOT NULL")).rowCount, 0);
  const token = (await client.query('SELECT id::text AS id,scope,code_nonce AS nonce,code_ciphertext AS ciphertext,code_tag AS tag,token_hash AS digest FROM exam_access_tokens')).rows[0];
  assert.equal(decryptSixDigitToken(token, tokenKey, token), "654321"); assert.deepEqual(token.digest, digestSixDigitToken("654321", tokenKey));
  assert.equal((await client.query("SELECT 1 FROM exam_schedule_runs WHERE id=$1 AND published_at IS NOT NULL", [runId])).rowCount, 1);
  for (const table of ["exam_question_snapshots", "exam_question_snapshot_images", "exam_attempts", "exam_attempt_questions", "exam_start_token_attempts"]) {
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${identifier(table)}`)).rows[0].n, 0);
  }
  assert.deepEqual((await client.query("SELECT id,failed_attempts FROM exam_start_token_global_limit")).rows, [{ id: 1, failed_attempts: 0 }]);

  // Constraint diuji dalam transaksi dan memakai ID eksplisit agar sequence
  // baru maupun lama tidak berubah. Tidak menghasilkan pengerjaan permanen.
  await client.query("BEGIN");
  try {
    await client.query(`INSERT INTO exam_question_snapshots(id,source_question_id,source_revision,source_updated_at,prompt_text,has_prompt_image,options,correct_option)
      OVERRIDING SYSTEM VALUE VALUES(99001,$1,'3',clock_timestamp(),'Snapshot 🧪',false,'{}'::jsonb,'A')`, [questionId]);
    await client.query("INSERT INTO exam_question_snapshot_images(snapshot_id,slot,mime,data) VALUES(99001,'prompt','image/png',decode('00','hex'))");
    await client.query(`INSERT INTO exam_attempts(id,run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,deadline,question_count)
      OVERRIDING SYSTEM VALUE VALUES(99001,$1,$2,19,'regular',42,$3,'SISWA FIKTIF','FIKTIF-042','X TEST','Tes Lama Fiktif','Sesi lama','WIB',clock_timestamp()+interval '1 hour',1)`, [runId, examId, studentId]);
    await client.query("INSERT INTO exam_attempt_questions(attempt_id,position,snapshot_id,option_order) VALUES(99001,1,99001,'ABCDE')");
    await rejectedAt("duplicate", `INSERT INTO exam_attempts(id,run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,deadline,question_count)
      OVERRIDING SYSTEM VALUE VALUES(99002,$1,$2,19,'regular',42,$3,'SISWA FIKTIF','FIKTIF-042','X TEST','Tes Lama Fiktif','Sesi lama','WIB',clock_timestamp()+interval '1 hour',1)`, [runId, examId, studentId], ["23505"]);
    await rejectedAt("bad_order", "INSERT INTO exam_attempt_questions(attempt_id,position,snapshot_id,option_order) VALUES(99001,2,99001,'AABCD')", [], ["23514"]);
    await rejectedAt("structure_edit", "UPDATE exam_attempt_questions SET option_order='EDCBA' WHERE attempt_id=99001", [], ["55000"]);
    await rejectedAt("bad_answer", "UPDATE exam_attempt_questions SET answer='F' WHERE attempt_id=99001", [], ["23514"]);
    await rejectedAt("snapshot_edit", "UPDATE exam_question_snapshots SET correct_option='B' WHERE id=99001", [], ["55000"]);
    await rejectedAt("image_delete", "DELETE FROM exam_question_snapshot_images WHERE snapshot_id=99001 AND slot='prompt'", [], ["55000"]);
    await rejectedAt("image_insert", "INSERT INTO exam_question_snapshot_images(snapshot_id,slot,mime,data) VALUES(99001,'A','image/png',decode('00','hex'))", [], ["55000"]);
    await rejectedAt("snapshot_delete", "DELETE FROM exam_question_snapshots WHERE id=99001", [], ["23503", "23001", "55000"]);
    await rejectedAt("run_delete", "DELETE FROM exam_schedule_runs WHERE id=$1", [runId], ["23503", "23001"]);
    await rejectedAt("identity_delete", "DELETE FROM participant_identities WHERE id=42", [], ["23503", "23001"]);
    await rejectedAt("invalid_grade", "UPDATE exam_attempts SET completed_at=deadline,completion_reason='time_expired',correct_count=2,answered_count=1 WHERE id=99001", [], ["23514"]);
  } finally { await client.query("ROLLBACK"); }
  assert.deepEqual(await snapshot(tables, sequences), before);
  console.log(`Migrasi 017 → terbaru dua kali: ${tables.length} tabel dan ${sequences.length} sequence lama identik; jadwal dirilis, sesi, sandi, token, soal dan kelompok tetap utuh.`);
  console.log("Tidak ada attempt atau snapshot dibuat otomatis; batas attempt, opsi, snapshot, relasi dan nilai diperiksa dengan rollback.");
} finally { key.fill(0); tokenKey.fill(0); await client.end().catch(() => {}); }
