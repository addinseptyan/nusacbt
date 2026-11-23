// Upgrade 022 -> 023 hanya pada database kosong khusus tes. Semua isi dan
// kunci dalam fixture ini fiktif; tidak membuat/menghapus/menimpa database.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";

import { decryptSixDigitToken, digestSixDigitToken, encryptSixDigitToken, examTokenKeyVerifier } from "../../src/lib/exam-token-crypto.mjs";
import { participantSessionDigest } from "../../src/lib/participant-login-validation.mjs";
import { decryptParticipantPassword, participantKeyVerifier } from "../../src/lib/participant-password-crypto.mjs";
import { hashPassword, verifyPassword } from "../../src/lib/password.mjs";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";

const database = "nusacbt_upgrade_023_test";
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
function migrate() {
  const result = spawnSync(process.execPath, [join(root, "scripts/migrate.mjs")], { cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, encoding: "utf8" });
  assert.equal(result.status, 0, `Migrasi uji gagal: ${result.stderr}`);
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
  const oldFiles = files.filter((file) => Number(file.slice(0, 3)) <= 22);
  assert.equal(oldFiles.length, 22); assert.ok(files.includes("023_exam_final_grades.sql"));
  await client.query("CREATE TABLE nusacbt_schema_migrations (version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
  for (const file of oldFiles) {
    const sql = (await readFile(join(root, "migrations", file), "utf8")).replace(/\r\n/g, "\n");
    await client.query("BEGIN");
    try { await client.query(sql); await client.query("INSERT INTO nusacbt_schema_migrations(version,checksum) VALUES($1,$2)", [file, createHash("sha256").update(sql).digest("hex")]); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  }

  const adminHash = await hashPassword("Admin-Upgrade-023-Fiktif!"); const session = randomBytes(32).toString("base64url");
  let admin, student, placement, testId, run, activeRun, completed, active, permission;
  await client.query("BEGIN");
  try {
    admin = (await client.query("INSERT INTO admin_users(username,password_hash) VALUES('admin_upgrade_023',$1) RETURNING id::text AS id", [adminHash])).rows[0].id;
    const major = (await client.query("INSERT INTO school_majors(name) VALUES('JURUSAN UJI 023') RETURNING id::text AS id")).rows[0].id;
    const schoolClass = (await client.query("INSERT INTO school_classes(level,major_id) VALUES('X',$1) RETURNING id::text AS id", [major])).rows[0].id;
    await client.query("INSERT INTO exam_periods(id,name,start_date,end_date) OVERRIDING SYSTEM VALUE VALUES(19,'Periode 023','2025-01-01','2028-12-31'),(20,'Periode lain 023','2029-01-01','2030-12-31')");
    await client.query("SELECT setval(pg_get_serial_sequence('exam_periods','id'),20,true)");
    student = (await client.query("INSERT INTO school_students(name,nisn) VALUES('Siswa Uji 🧪','0123456789') RETURNING id::text AS id")).rows[0].id;
    placement = (await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,19,$2,'X JURUSAN UJI 023') RETURNING id::text AS id", [student, schoolClass])).rows[0].id;
    await client.query("INSERT INTO participant_identities(id,student_id,period_id,participant_number,username) OVERRIDING SYSTEM VALUE VALUES(42,$1,19,'FIKTIF-042','MiX.Fiktif_042')", [student]);
    await client.query("SELECT setval(pg_get_serial_sequence('participant_identities','id'),42,true)");
    await client.query("INSERT INTO participant_password_key_binding(id,verifier) VALUES(1,$1)", [participantKeyVerifier(key)]);
    await client.query("INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES(42,$1,$2,$3,$4)", [vector.hash, Buffer.from(vector.nonce, "base64"), Buffer.from(vector.ciphertext, "base64"), Buffer.from(vector.authenticationTag, "base64")]);
    await client.query("INSERT INTO participant_password_audit(participant_identity_id,admin_id,event) VALUES(42,$1,'create_manual')", [admin]);
    await client.query("UPDATE participant_login_settings SET period_id=19 WHERE id=1");
    await client.query(`INSERT INTO participant_sessions(token_hash,participant_identity_id,placement_id,username_snapshot,identity_revision,password_revision,password_hash_digest,expires_at)
      SELECT $1,i.id,$2,i.username,i.updated_at,pw.updated_at,sha256(convert_to(pw.password_hash,'UTF8')),clock_timestamp()+interval '8 hours'
      FROM participant_identities i JOIN participant_passwords pw ON pw.participant_identity_id=i.id WHERE i.id=42`, [participantSessionDigest(session), placement]);
    const topic = (await client.query("INSERT INTO question_topics(name) VALUES('Topik العربية 🧪') RETURNING id::text AS id")).rows[0].id;
    const question = (await client.query(`INSERT INTO question_bank(topic_id,prompt_text,option_a_text,option_b_text,option_c_text,option_d_text,option_e_text,correct_option)
      VALUES($1,'Soal lama 🧪','A','B','C','D','E','A') RETURNING id::text AS id`, [topic])).rows[0].id;
    testId = (await client.query(`INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes)
      VALUES(19,'Tes Uji 023',clock_timestamp()-interval '5 minutes','WIB',60) RETURNING id::text AS id`)).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)", [testId, question]);
    const createRun = async (kind, label) => (await client.query(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
      VALUES($1,19,$2,$3,clock_timestamp()-interval '5 minutes','WIB',60,$4,clock_timestamp(),$4) RETURNING id::text AS id`, [testId, kind, label, admin])).rows[0].id;
    run = await createRun("makeup", "Susulan uji"); activeRun = await createRun("remedial", "Remidi uji");
    for (const [runId, kind] of [[run, "makeup"], [activeRun, "remedial"]]) await client.query("INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id) VALUES($1,$2,19,$3,$4,$5)", [runId, testId, kind, student, placement]);
    const snap = (await client.query(`INSERT INTO exam_question_snapshots(source_question_id,source_revision,source_updated_at,prompt_text,prompt_rich,has_prompt_image,options,correct_option)
      SELECT id,xmin::text,updated_at,prompt_text,prompt_rich,true,
       jsonb_build_object('A',jsonb_build_object('text','A','rich',null,'hasImage',false),'B',jsonb_build_object('text','B','rich',null,'hasImage',false),
        'C',jsonb_build_object('text','C','rich',null,'hasImage',false),'D',jsonb_build_object('text','D','rich',null,'hasImage',false),
        'E',jsonb_build_object('text','E','rich',null,'hasImage',false)),correct_option FROM question_bank WHERE id=$1 RETURNING id::text AS id`, [question])).rows[0].id;
    await client.query("INSERT INTO exam_question_snapshot_images(snapshot_id,slot,mime,data) VALUES($1,'prompt','image/png',decode('000102ff','hex'))", [snap]);
    const createAttempt = async (runId, kind, label, answer) => {
      const id = (await client.query(`INSERT INTO exam_attempts(run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,deadline,question_count)
        VALUES($1,$2,19,$3,42,$4,'Siswa Uji 🧪','FIKTIF-042','X JURUSAN UJI 023','Tes Uji 023',$5,'WIB',clock_timestamp()+interval '1 hour',1) RETURNING id::text AS id`, [runId, testId, kind, student, label])).rows[0].id;
      await client.query("INSERT INTO exam_attempt_questions(attempt_id,position,snapshot_id,option_order,answer,answer_revision,answered_at,is_doubtful,doubt_revision) VALUES($1,1,$2,'ABCDE',$3,2,clock_timestamp(),true,3)", [id, snap, answer]);
      return id;
    };
    completed = await createAttempt(run, "makeup", "Susulan uji", "A"); active = await createAttempt(activeRun, "remedial", "Remidi uji", "B");
    await client.query("UPDATE exam_attempts SET completed_at=clock_timestamp(),completion_reason='submitted',correct_count=1,answered_count=1 WHERE id=$1", [completed]);
    permission = (await client.query("INSERT INTO exam_retake_permissions(run_id,participant_identity_id,previous_attempt_id,granted_by) VALUES($1,42,$2,$3) RETURNING id::text AS id", [run, completed, admin])).rows[0].id;
    await client.query("INSERT INTO exam_retake_operations(operation_id,attempt_id,action,result,permission_id) VALUES($1,$2,'grant','applied',$3),($4,$2,'revoke','cancelled',NULL)", [randomUUID(), completed, permission, randomUUID()]);
    await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=false,revision=6,updated_by=$1 WHERE kind='makeup'", [admin]);
    await client.query("INSERT INTO exam_token_key_binding(id,verifier) VALUES(1,$1)", [examTokenKeyVerifier(tokenKey)]);
    const tokenId = (await client.query("SELECT nextval(pg_get_serial_sequence('exam_access_tokens','id'))::text AS id")).rows[0].id;
    const code = "654321", encrypted = encryptSixDigitToken(code, tokenKey, { id: tokenId, scope: "test" });
    await client.query(`WITH m AS (SELECT clock_timestamp() AS issued)
      INSERT INTO exam_access_tokens(id,scope,exam_test_id,test_name_snapshot,token_hash,duration_minutes,issued_at,expires_at,code_version,code_nonce,code_ciphertext,code_tag)
      OVERRIDING SYSTEM VALUE SELECT $1,'test',$2,'Tes Uji 023',$3,15,issued,issued+interval '15 minutes',2,$4,$5,$6 FROM m`,
      [tokenId, testId, digestSixDigitToken(code, tokenKey), encrypted.nonce, encrypted.ciphertext, encrypted.tag]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }

  const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT IN ('nusacbt_schema_migrations','participant_login_settings','participant_sessions') ORDER BY table_name")).rows.map((row) => row.table_name);
  const sequences = (await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows.map((row) => row.sequencename);
  const before = await snapshot(tables, sequences);
  const history = (await client.query("SELECT version,checksum,applied_at FROM nusacbt_schema_migrations ORDER BY version")).rows;
  assert.equal(history.length, 22); migrate(); migrate();
  assert.deepEqual(await snapshot(tables, sequences), before, "Semua tabel dan sequence 022 harus identik.");
  assert.equal((await client.query("SELECT count(*)::int AS n FROM admin_users WHERE NOT (is_superuser AND is_active AND full_name = username AND role_id IS NULL)")).rows[0].n, 0);
  const afterHistory = (await client.query("SELECT version,checksum,applied_at FROM nusacbt_schema_migrations ORDER BY version")).rows;
  assert.deepEqual(afterHistory.slice(0, 22), history); assert.equal(afterHistory.length, files.length); assert.equal(afterHistory[22].version, "023_exam_final_grades.sql");
  for (const table of ["exam_final_grade_settings", "exam_final_grade_state", "exam_final_grade_operations"]) assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
  assert.equal((await client.query("SELECT COALESCE(s.method,'highest') AS method FROM exam_tests t LEFT JOIN exam_final_grade_settings s ON s.exam_test_id=t.id WHERE t.id=$1", [testId])).rows[0].method, "highest");
  assert.equal((await client.query("SELECT encode(data,'hex') AS hex FROM exam_question_snapshot_images")).rows[0].hex, "000102ff");
  const stored = (await client.query('SELECT password_hash AS hash,nonce,ciphertext,authentication_tag AS "authenticationTag" FROM participant_passwords WHERE participant_identity_id=42')).rows[0];
  assert.equal(await verifyPassword(vector.password, stored.hash), true); assert.equal(decryptParticipantPassword(stored, key, vectorFile.binding), vector.password);
  assert.equal((await client.query("SELECT period_id FROM participant_login_settings WHERE id=1")).rows[0].period_id, null);
  assert.equal((await client.query("SELECT 1 FROM participant_sessions WHERE token_hash=$1", [participantSessionDigest(session)])).rowCount, 0);
  assert.equal((await client.query("SELECT 1 FROM exam_periods WHERE academic_year_id IS NOT NULL")).rowCount, 0);
  const token = (await client.query('SELECT id::text AS id,scope,code_nonce AS nonce,code_ciphertext AS ciphertext,code_tag AS tag,token_hash AS digest FROM exam_access_tokens')).rows[0];
  assert.equal(decryptSixDigitToken(token, tokenKey, token), "654321"); assert.deepEqual(token.digest, digestSixDigitToken("654321", tokenKey));

  await client.query("BEGIN");
  try {
    await rejectedAt("method_bad", "INSERT INTO exam_final_grade_settings(exam_test_id,method,revision) VALUES($1,'bad',1)", [testId], ["23514"]);
    await rejectedAt("method_rev", "INSERT INTO exam_final_grade_settings(exam_test_id,method,revision) VALUES($1,'average',0)", [testId], ["23514"]);
    await rejectedAt("period_wrong", "INSERT INTO exam_final_grade_state(exam_test_id,participant_identity_id,period_id,revision) VALUES($1,42,20,1)", [testId], ["23503"]);
    await rejectedAt("final_rev", "INSERT INTO exam_final_grade_state(exam_test_id,participant_identity_id,period_id,revision) VALUES($1,42,19,0)", [testId], ["23514"]);
    await rejectedAt("actor_without_final", "INSERT INTO exam_final_grade_state(exam_test_id,participant_identity_id,period_id,revision,finalized_by) VALUES($1,42,19,1,$2)", [testId, admin], ["23514"]);
    await rejectedAt("cancelled_values", "INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,action,result,old_value) VALUES($1,$2,'method','cancelled','highest')", [randomUUID(), testId], ["23514"]);
    await rejectedAt("method_target", "INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,participant_identity_id,action,result) VALUES($1,$2,42,'method','cancelled')", [randomUUID(), testId], ["23514"]);
    await rejectedAt("missing_snapshot", `INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,participant_identity_id,action,result,old_value,new_value,revision,revoked_permissions)
      VALUES($1,$2,42,'finalize','applied','open','final',1,0)`, [randomUUID(), testId], ["23514"]);
    await rejectedAt("mismatched_ids", `INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,participant_identity_id,action,result,old_value,new_value,revision,revoked_permissions,recorded_method,recorded_hundredths,recorded_attempt_count,recorded_attempt_ids)
      VALUES($1,$2,42,'finalize','applied','open','final',1,0,'highest',10000,2,ARRAY[$3::bigint])`, [randomUUID(), testId, completed], ["23514"]);
    const draft = (await client.query("INSERT INTO exam_tests(id,period_id,name,starts_at,time_zone,duration_minutes) OVERRIDING SYSTEM VALUE VALUES(99023,19,'Draf yang dihapus',clock_timestamp(),'WIB',60) RETURNING id::text AS id")).rows[0].id;
    const draftOperation = randomUUID();
    await client.query("INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,action,result,old_value,new_value,revision) VALUES($1,$2,'method','applied','highest','average',1)", [draftOperation, draft]);
    await client.query("DELETE FROM exam_tests WHERE id=$1", [draft]);
    assert.equal((await client.query("SELECT 1 FROM exam_final_grade_operations WHERE operation_id=$1", [draftOperation])).rowCount, 1, "Jejak dan pagar bertahan setelah penghapusan draf.");
    await client.query("INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,action,result) VALUES($1,$2,'method','cancelled')", [randomUUID(), draft]);
  } finally { await client.query("ROLLBACK"); }
  assert.deepEqual(await snapshot(tables, sequences), before);

  // Buat keadaan 023 yang konsisten hanya pada fixture, lalu migrator sekali
  // lagi. Bahan ini juga dapat dipakai untuk uji cadangan/pemulihan terisolasi.
  await client.query("BEGIN");
  try {
    await client.query("UPDATE exam_attempts SET completed_at=clock_timestamp(),completion_reason='submitted',correct_count=0,answered_count=1 WHERE id=$1", [active]);
    await client.query("UPDATE exam_retake_permissions SET revoked_at=clock_timestamp(),revoked_by=$2 WHERE id=$1", [permission, admin]);
    await client.query("INSERT INTO exam_final_grade_settings(exam_test_id,method,revision,updated_by) VALUES($1,'average',1,$2)", [testId, admin]);
    await client.query("INSERT INTO exam_final_grade_state(exam_test_id,participant_identity_id,period_id,finalized_at,finalized_by,revision,updated_by) VALUES($1,42,19,clock_timestamp(),$2,1,$2)", [testId, admin]);
    await client.query("INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,action,result,old_value,new_value,revision,actor_id) VALUES($1,$2,'method','applied','highest','average',1,$3)", [randomUUID(), testId, admin]);
    await client.query(`INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,participant_identity_id,action,result,old_value,new_value,revision,revoked_permissions,recorded_method,recorded_hundredths,recorded_attempt_count,recorded_attempt_ids,actor_id)
      VALUES($1,$2,42,'finalize','applied','open','final',1,1,'average',5000,2,ARRAY[$3::bigint,$4::bigint],$5)`, [randomUUID(), testId, completed, active, admin]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  const newTables = [...tables, "exam_final_grade_settings", "exam_final_grade_state", "exam_final_grade_operations"];
  const finalBefore = await snapshot(newTables, sequences); migrate(); assert.deepEqual(await snapshot(newTables, sequences), finalBefore);
  console.log(`Migrasi 022 → 023: ${tables.length} tabel dan ${sequences.length} sequence lama identik; jawaban, nilai, izin, audit, gambar, sesi, token, sandi dan kebijakan tetap utuh.`);
  console.log("Default, foreign key periode, batas metode/revisi, snapshot audit dan pengulangan migrator diuji pada data fiktif.");
} finally { key.fill(0); tokenKey.fill(0); await client.end().catch(() => {}); }
