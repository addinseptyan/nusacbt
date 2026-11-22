// Upgrade 023 -> 024 memakai skema sementara di dalam database uji.
// Seluruh DDL dan fixture dibatalkan pada akhir transaksi; database lain tidak disentuh.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
import { postgresConfig } from '../../src/lib/postgres-config.mjs';
import { participantSessionDigest } from '../../src/lib/participant-login-validation.mjs';
import { decryptParticipantPassword, participantKeyVerifier } from '../../src/lib/participant-password-crypto.mjs';
import { verifyPassword } from '../../src/lib/password.mjs';

if (process.env.PGDATABASE !== 'nusacbt_test' || process.env.NUSACBT_CONFIRM_TEST_DATABASE !== 'nusacbt_test') {
  throw new Error('Wajib database terisolasi nusacbt_test dan NUSACBT_CONFIRM_TEST_DATABASE=nusacbt_test.');
}
const root = fileURLToPath(new URL('../..', import.meta.url));
const vectorFile = JSON.parse(await readFile(new URL('../fixtures/participant-password-v014.json', import.meta.url), 'utf8'));
const vector = vectorFile.vectors[0], key = Buffer.from(vectorFile.key, 'base64');
const schema = `upgrade_024_${randomBytes(6).toString('hex')}`;
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
  const old = files.filter((x) => Number(x.slice(0, 3)) <= 23);
  assert.equal(old.length, 23);
  for (const file of old) await client.query(await readFile(join(root, 'migrations', file), 'utf8'));

  const admin = (await client.query("INSERT INTO admin_users(username,password_hash) VALUES('upgrade024admin','fixture') RETURNING id::text AS id")).rows[0].id;
  const major = (await client.query("INSERT INTO school_majors(name) VALUES('JURUSAN UJI 024') RETURNING id::text AS id")).rows[0].id;
  const klass = (await client.query("INSERT INTO school_classes(level,major_id) VALUES('X',$1) RETURNING id::text AS id", [major])).rows[0].id;
  await client.query("INSERT INTO exam_periods(id,name,start_date,end_date) OVERRIDING SYSTEM VALUE VALUES(19,'Periode Uji 024','2025-01-01','2026-12-31')");
  await client.query("SELECT setval(pg_get_serial_sequence('exam_periods','id'),19,true)");
  const student = (await client.query("INSERT INTO school_students(name,nisn) VALUES('SISWA UJI 024','0123456789') RETURNING id::text AS id")).rows[0].id;
  const placement = (await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,19,$2,'X JURUSAN UJI 024') RETURNING id::text AS id", [student, klass])).rows[0].id;
  await client.query("INSERT INTO participant_identities(id,student_id,period_id,participant_number,username) OVERRIDING SYSTEM VALUE VALUES(42,$1,19,'UJI024','peserta024')", [student]);
  await client.query("SELECT setval(pg_get_serial_sequence('participant_identities','id'),42,true)");
  await client.query('INSERT INTO participant_password_key_binding(id,verifier) VALUES(1,$1)', [participantKeyVerifier(key)]);
  await client.query('INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES(42,$1,$2,$3,$4)', [vector.hash,Buffer.from(vector.nonce,'base64'),Buffer.from(vector.ciphertext,'base64'),Buffer.from(vector.authenticationTag,'base64')]);
  await client.query("INSERT INTO participant_password_audit(participant_identity_id,admin_id,event) VALUES(42,$1,'create_manual')", [admin]);
  await client.query('UPDATE participant_login_settings SET period_id=19 WHERE id=1');
  const session = randomBytes(32).toString('base64url');
  await client.query(`INSERT INTO participant_sessions(token_hash,participant_identity_id,placement_id,username_snapshot,identity_revision,password_revision,password_hash_digest,expires_at)
    SELECT $1,i.id,$2,i.username,i.updated_at,p.updated_at,sha256(convert_to(p.password_hash,'UTF8')),clock_timestamp()+interval '8 hours'
    FROM participant_identities i JOIN participant_passwords p ON p.participant_identity_id=i.id WHERE i.id=42`, [participantSessionDigest(session),placement]);
  const topic = (await client.query("INSERT INTO question_topics(name) VALUES('Topik Uji 024') RETURNING id::text AS id")).rows[0].id;
  const question = (await client.query(`INSERT INTO question_bank(topic_id,prompt_text,option_a_text,option_b_text,option_c_text,option_d_text,option_e_text,correct_option)
    VALUES($1,'Soal lama uji','A','B','C','D','E','A') RETURNING id::text AS id`, [topic])).rows[0].id;
  const test = (await client.query("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES(19,'Matematika Uji 024',clock_timestamp()-interval '5 minutes','WIB',90) RETURNING id::text AS id")).rows[0].id;
  await client.query('INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)', [test,question]);
  const run = (await client.query(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
    VALUES($1,19,'makeup','Susulan uji',clock_timestamp()-interval '5 minutes','WIB',90,$2,clock_timestamp(),$2) RETURNING id::text AS id`, [test,admin])).rows[0].id;
  await client.query("INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id) VALUES($1,$2,19,'makeup',$3,$4)", [run,test,student,placement]);
  const attempt = (await client.query(`INSERT INTO exam_attempts(run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,started_at,deadline,question_count,completed_at,completion_reason,correct_count,answered_count)
    VALUES($1,$2,19,'makeup',42,$3,'SISWA UJI 024','UJI024','X JURUSAN UJI 024','Matematika Uji 024','Susulan uji','WIB',clock_timestamp()-interval '4 minutes',clock_timestamp()+interval '1 hour',1,clock_timestamp()-interval '1 minute','submitted',1,1) RETURNING id::text AS id`, [run,test,student])).rows[0].id;
  const permission = (await client.query('INSERT INTO exam_retake_permissions(run_id,participant_identity_id,previous_attempt_id,granted_by) VALUES($1,42,$2,$3) RETURNING id::text AS id', [run,attempt,admin])).rows[0].id;
  await client.query("INSERT INTO exam_retake_operations(operation_id,attempt_id,action,result,permission_id) VALUES($1,$2,'grant','applied',$3)", [randomUUID(),attempt,permission]);
  await client.query("INSERT INTO exam_final_grade_settings(exam_test_id,method,revision,updated_by) VALUES($1,'average',1,$2)", [test,admin]);
  await client.query('INSERT INTO exam_final_grade_state(exam_test_id,participant_identity_id,period_id,finalized_at,finalized_by,revision,updated_by) VALUES($1,42,19,clock_timestamp(),$2,1,$2)', [test,admin]);
  await client.query(`INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,participant_identity_id,action,result,old_value,new_value,revision,revoked_permissions,recorded_method,recorded_hundredths,recorded_attempt_count,recorded_attempt_ids,actor_id)
    VALUES($1,$2,42,'finalize','applied','open','final',1,0,'average',10000,1,ARRAY[$3::bigint],$4)`, [randomUUID(),test,attempt,admin]);
  const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name", [schema])).rows.map((r) => r.table_name);
  const unchanged = tables.filter((t) => !['exam_periods','participant_sessions','participant_login_settings'].includes(t));
  const before = await snapshot(unchanged);
  const oldPeriod = (await client.query('SELECT to_jsonb(p) AS row FROM exam_periods p WHERE id=19')).rows[0].row;
  const sequences = (await client.query('SELECT sequencename,last_value FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename', [schema])).rows;
  await client.query(await readFile(join(root,'migrations','024_academic_years.sql'),'utf8'));
  assert.deepEqual(await snapshot(unchanged), before, 'Tabel lama lain harus tetap identik.');
  assert.deepEqual((await client.query("SELECT to_jsonb(p)-'academic_year_id' AS row FROM exam_periods p WHERE id=19")).rows[0].row, oldPeriod);
  assert.equal((await client.query('SELECT academic_year_id FROM exam_periods WHERE id=19')).rows[0].academic_year_id, null);
  assert.equal((await client.query('SELECT period_id FROM participant_login_settings WHERE id=1')).rows[0].period_id, null);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM participant_sessions')).rows[0].n, 0);
  assert.equal((await client.query('SELECT active_year_id FROM academic_year_settings WHERE id=1')).rows[0].active_year_id, null);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM academic_year_enrollments')).rows[0].n, 0);
  const afterSequences = (await client.query('SELECT sequencename,last_value FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename', [schema])).rows;
  for (const row of sequences) assert.deepEqual(afterSequences.find((x) => x.sequencename === row.sequencename), row);
  const stored = (await client.query('SELECT password_hash AS hash,nonce,ciphertext,authentication_tag AS "authenticationTag" FROM participant_passwords WHERE participant_identity_id=42')).rows[0];
  assert.equal(await verifyPassword(vector.password,stored.hash),true);
  assert.equal(decryptParticipantPassword(stored,key,vectorFile.binding),vector.password);
  const year = (await client.query("INSERT INTO academic_years(name) VALUES('2026/2027') RETURNING id::text AS id")).rows[0].id;
  await client.query("INSERT INTO academic_year_enrollments(academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES($1,$2,$3,'X JURUSAN UJI 024','active')", [year,student,klass]);
  await rejects("INSERT INTO academic_year_enrollments(academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES($1,$2,$3,'X','active')", [year,student,klass], ['23505']);
  await rejects('UPDATE academic_year_settings SET active_year_id=99999999 WHERE id=1', [], ['23503']);
  await rejects("UPDATE academic_year_enrollments SET status='unknown' WHERE academic_year_id=$1", [year], ['23514']);
  console.log(`Upgrade 023→024 lulus: ${unchanged.length} tabel lama dan ${sequences.length} sequence identik; periode tidak dipetakan, login/sesi dinonaktifkan, sandi dan riwayat dipertahankan.`);
} finally {
  key.fill(0);
  await client.query('ROLLBACK').catch(() => {});
  await client.end().catch(() => {});
}
