// Upgrade 020 -> 021 hanya pada database kosong khusus tes. Tidak membuat,
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

const database = "nusacbt_upgrade_021_test";
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
    // Semua kolom versi 020, termasuk status ragu, harus identik;
    // academic_year_id ditambahkan pada migrasi 024 dan diperiksa terpisah.
    const object = table === "exam_periods"
      ? "(to_jsonb(r)-'academic_year_id'-'is_active')"
      : table === "question_topics"
        ? "(to_jsonb(r)-'tags'-'tags_signature')"
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
  const oldFiles = files.filter((file) => Number(file.slice(0, 3)) <= 20);
  assert.equal(oldFiles.length, 20); assert.ok(files.includes("021_exam_score_category_visibility.sql"));
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
  let adminId, studentId, placementId, questionId, examId, runId, legacyOpenTest;
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


  // Data 019: satu attempt berjalan dan satu selesai memakai snapshot/gambar
  // bersama, agar migrasi diuji terhadap jawaban dan hasil yang sungguhan ada.
  await client.query("BEGIN");
  try {
    const snap = (await client.query(`INSERT INTO exam_question_snapshots(source_question_id,source_revision,source_updated_at,prompt_text,prompt_rich,has_prompt_image,options,correct_option)
      SELECT id,xmin::text,updated_at,prompt_text,prompt_rich,true,
       jsonb_build_object('A',jsonb_build_object('text','A','rich',null,'hasImage',false),'B',jsonb_build_object('text','B','rich',null,'hasImage',false),
        'C',jsonb_build_object('text','C','rich',null,'hasImage',false),'D',jsonb_build_object('text','D','rich',null,'hasImage',false),
        'E',jsonb_build_object('text','E','rich',null,'hasImage',false)),correct_option
      FROM question_bank WHERE id=$1 RETURNING id::text AS id`, [questionId])).rows[0].id;
    await client.query("INSERT INTO exam_question_snapshot_images(snapshot_id,slot,mime,data) VALUES($1,'prompt','image/png',decode('000102ff','hex'))", [snap]);
    const active = (await client.query(`INSERT INTO exam_attempts(run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,deadline,question_count)
      VALUES($1,$2,19,'regular',42,$3,'Siswa Fiktif 🧪','FIKTIF-042','X JURUSAN UJI 018','Tes Lama Fiktif','Sesi lama','WIB',clock_timestamp()+interval '1 hour',1) RETURNING id::text AS id`, [runId,examId,studentId])).rows[0].id;
    await client.query("INSERT INTO exam_attempt_questions(attempt_id,position,snapshot_id,option_order,answer,answer_revision,answered_at) VALUES($1,1,$2,'CEDAB','A',1,clock_timestamp())", [active,snap]);
    const makeup = (await client.query(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
      VALUES($1,19,'makeup','Susulan fiktif',clock_timestamp()-interval '5 minutes','WIB',60,$2,clock_timestamp(),$2) RETURNING id::text AS id`, [examId,adminId])).rows[0].id;
    await client.query("INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id) VALUES($1,$2,19,'makeup',$3,$4)", [makeup,examId,studentId,placementId]);
    const completed = (await client.query(`INSERT INTO exam_attempts(run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,deadline,question_count)
      VALUES($1,$2,19,'makeup',42,$3,'Siswa Fiktif 🧪','FIKTIF-042','X JURUSAN UJI 018','Tes Lama Fiktif','Susulan fiktif','WIB',clock_timestamp()+interval '1 hour',1) RETURNING id::text AS id`, [makeup,examId,studentId])).rows[0].id;
    await client.query("INSERT INTO exam_attempt_questions(attempt_id,position,snapshot_id,option_order,answer,answer_revision,answered_at) VALUES($1,1,$2,'ABCDE','A',2,clock_timestamp())", [completed,snap]);
    await client.query("UPDATE exam_attempts SET completed_at=clock_timestamp(),completion_reason='submitted',correct_count=1,answered_count=1 WHERE id=$1", [completed]);
    await client.query("UPDATE exam_attempt_questions SET is_doubtful=true,doubt_revision=7 WHERE attempt_id=$1", [active]);
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=13,revision=5,updated_by=$1,updated_at=clock_timestamp() WHERE id=1", [adminId]);
    await client.query("INSERT INTO exam_score_visibility(exam_test_id,visible_to_participants,revision,updated_by) VALUES($1,false,7,$2)", [examId,adminId]);
    legacyOpenTest = (await client.query("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES(19,'Tes lama nilai dibuka',clock_timestamp(),'WITA',60) RETURNING id")).rows[0].id;
    await client.query("INSERT INTO exam_score_visibility(exam_test_id,visible_to_participants,revision,updated_by) VALUES($1,true,3,$2)", [legacyOpenTest,adminId]);
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
  assert.equal((await client.query("SELECT count(*)::int AS n FROM admin_users WHERE NOT (is_superuser AND is_active AND full_name = username AND role_id IS NULL)")).rows[0].n, 0);
  const afterHistory = (await client.query("SELECT version,checksum,applied_at FROM nusacbt_schema_migrations ORDER BY version")).rows;
  assert.deepEqual(afterHistory.slice(0, 20), history);
  assert.equal(afterHistory.length, files.length);
  assert.equal(afterHistory[20].version, "021_exam_score_category_visibility.sql");
  assert.deepEqual((await client.query("SELECT kind,visible_to_participants AS visible,revision::text AS revision FROM exam_score_category_visibility ORDER BY kind")).rows,
    [{ kind: "makeup", visible: true, revision: "0" }, { kind: "regular", visible: true, revision: "0" }, { kind: "remedial", visible: true, revision: "0" }]);
  assert.deepEqual((await client.query("SELECT exam_test_id::text AS id,visible_to_participants AS visible,revision::text AS revision FROM exam_score_visibility ORDER BY exam_test_id")).rows,
    [{ id: examId, visible: false, revision: "7" }, { id: legacyOpenTest, visible: true, revision: "3" }]);
  // Hasil lama yang tadinya tertutup kini terbuka sesuai keputusan eksplisit,
  // tetapi attempt yang masih berjalan tidak termasuk.
  assert.equal((await client.query(`SELECT count(*)::int AS n FROM exam_attempts a JOIN exam_score_category_visibility v
    ON v.kind=a.kind AND v.visible_to_participants WHERE a.completed_at IS NOT NULL AND a.exam_test_id=$1`, [examId])).rows[0].n, 1);
  assert.deepEqual((await client.query("SELECT completion_reason,correct_count,answered_count FROM exam_attempts ORDER BY id")).rows,
    [{ completion_reason: null, correct_count: null, answered_count: null }, { completion_reason: "submitted", correct_count: 1, answered_count: 1 }]);
  assert.equal((await client.query("SELECT encode(data,'hex') AS hex FROM exam_question_snapshot_images")).rows[0].hex, "000102ff");
  const stored = (await client.query('SELECT password_hash AS hash,nonce,ciphertext,authentication_tag AS "authenticationTag" FROM participant_passwords WHERE participant_identity_id=42')).rows[0];
  assert.equal(await verifyPassword(vector.password, stored.hash), true);
  assert.equal(decryptParticipantPassword(stored, key, vectorFile.binding), vector.password);
  assert.equal((await client.query("SELECT period_id FROM participant_login_settings WHERE id=1")).rows[0].period_id, null);
  assert.equal((await client.query("SELECT 1 FROM participant_sessions WHERE token_hash=$1", [participantSessionDigest(session)])).rowCount, 0);
  assert.equal((await client.query("SELECT 1 FROM exam_periods WHERE academic_year_id IS NOT NULL")).rowCount, 0);
  const token = (await client.query('SELECT id::text AS id,scope,code_nonce AS nonce,code_ciphertext AS ciphertext,code_tag AS tag,token_hash AS digest FROM exam_access_tokens')).rows[0];
  assert.equal(decryptSixDigitToken(token, tokenKey, token), "654321"); assert.deepEqual(token.digest, digestSixDigitToken("654321", tokenKey));

  await client.query("BEGIN");
  try {
    await rejectedAt("unknown_kind", "INSERT INTO exam_score_category_visibility(kind) VALUES('other')", [], ["23514"]);
    await rejectedAt("duplicate_kind", "INSERT INTO exam_score_category_visibility(kind) VALUES('regular')", [], ["23505"]);
    await rejectedAt("null_visible", "UPDATE exam_score_category_visibility SET visible_to_participants=NULL WHERE kind='regular'", [], ["23502"]);
    await rejectedAt("negative_revision", "UPDATE exam_score_category_visibility SET revision=-1 WHERE kind='regular'", [], ["23514"]);
    await rejectedAt("infinite_timestamp", "UPDATE exam_score_category_visibility SET updated_at='infinity' WHERE kind='regular'", [], ["23514"]);
    await rejectedAt("unknown_admin", "UPDATE exam_score_category_visibility SET updated_by=9223372036854775807 WHERE kind='regular'", [], ["23503"]);
    const spare = (await client.query("INSERT INTO admin_users(id,username,password_hash) OVERRIDING SYSTEM VALUE VALUES(9000000001,'admin_category_spare',$1) RETURNING id", [adminHash])).rows[0].id;
    await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=false,revision=revision+1,updated_by=$1 WHERE kind='regular'", [spare]);
    await client.query("DELETE FROM admin_users WHERE id=$1", [spare]);
    assert.deepEqual((await client.query("SELECT visible_to_participants AS visible,revision::text AS revision,updated_by AS admin FROM exam_score_category_visibility WHERE kind='regular'")).rows,
      [{ visible: false, revision: "1", admin: null }]);
  } finally { await client.query("ROLLBACK"); }
  // Pengulangan migrasi tidak boleh membuka kembali kategori yang disembunyikan admin.
  await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=false,revision=4,updated_by=$1 WHERE kind='regular'", [adminId]);
  const migrateAgain = spawnSync(process.execPath, [join(root, "scripts/migrate.mjs")], { cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, encoding: "utf8" });
  assert.equal(migrateAgain.status, 0, `Migrasi ulang gagal: ${migrateAgain.stderr}`);
  assert.deepEqual((await client.query("SELECT visible_to_participants AS visible,revision::text AS revision FROM exam_score_category_visibility WHERE kind='regular'")).rows, [{ visible: false, revision: "4" }]);
  assert.deepEqual(await snapshot(tables, sequences), before);
  console.log(`Migrasi 020 → terbaru (021–023): ${tables.length} tabel dan ${sequences.length} sequence lama identik; sesi, sandi, token, jawaban, nilai, gambar, dan kebijakan lama tetap utuh.`);
  console.log("Ketiga kategori dibuka secara default termasuk hasil lama; constraint dan pengulangan yang tidak me-reset kebijakan diuji.");
} finally { key.fill(0); tokenKey.fill(0); await client.end().catch(() => {}); }
