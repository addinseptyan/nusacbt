import { randomBytes, randomInt } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import pg from "pg";

import { encryptParticipantPassword, participantKeyVerifier, readParticipantKeyFile } from "../../src/lib/participant-password-crypto.mjs";
import { participantAttemptBucket } from "../../src/lib/participant-login-validation.mjs";
import { hashParticipantPassword } from "../../src/lib/password.mjs";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";

export type LoginFixture = {
  suffix: string; username: string; passwordA: string; passwordB: string;
  periodA: string; periodB: string; periodAName: string; periodBName: string; yearId: string;
  majorId: string; classId: string; majorName: string;
  studentA: string; studentB: string; studentAName: string; studentBName: string;
  identityA: string; identityB: string; placementA: string; placementB: string;
  activeTest: string; activeName: string; futureName: string; pastName: string; hiddenName: string;
  questionId: string; topicId: string; questionSecret: string;
};

export function loginTestDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") throw new Error("Tes login peserta hanya boleh memakai PGDATABASE=nusacbt_test khusus uji.");
  if (!process.env.NUSACBT_PARTICIPANT_KEY_FILE) throw new Error("Kunci sandi fiktif khusus pengujian diperlukan.");
  return new pg.Client(postgresConfig());
}

export async function resetLoginGlobal(client: pg.Client) {
  await client.query("UPDATE participant_login_global_limit SET attempts=0, window_started_at=clock_timestamp() - interval '2 minutes' WHERE id=1");
}

// Fixture langsung untuk tes login/paginasi lama. Skenario administrasi baru
// menguji rilis lewat UI, bukan memanggil helper ini.
export async function seedPublishedSchedules(client: pg.Client, testIds: string[], studentId: string, placementId: string) {
  const runs = (await client.query<{ id: string; test: string; period: string }>(
    `INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
     SELECT e.id,e.period_id,'makeup','Jadwal fiktif',e.starts_at,e.time_zone,e.duration_minutes,a.id,clock_timestamp(),a.id
     FROM exam_tests e CROSS JOIN (SELECT id FROM admin_users WHERE username=$2) a WHERE e.id=ANY($1::bigint[])
     RETURNING id::text AS id,exam_test_id::text AS test,period_id::text AS period`, [testIds, process.env.TEST_ADMIN_USERNAME],
  )).rows;
  if (runs.length !== testIds.length) throw new Error("Admin atau tes fixture tidak ditemukan.");
  for (const run of runs) await client.query(
    `INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id)
     VALUES($1,$2,$3,'makeup',$4,$5)`, [run.id, run.test, run.period, studentId, placementId],
  );
}

export async function seedLoginFixture(client: pg.Client): Promise<LoginFixture> {
  const suffix = randomBytes(5).toString("hex");
  const username = `p${suffix}`;
  const passwordA = "ABCDEFGH";
  const passwordB = "HGFEDCBA";
  const [hashA, hashB] = await Promise.all([hashParticipantPassword(passwordA), hashParticipantPassword(passwordB)]);
  const key = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, process.cwd());
  try {
    await client.query("BEGIN");
    const verifier = participantKeyVerifier(key);
    await client.query("INSERT INTO participant_password_key_binding(id,verifier) VALUES(1,$1) ON CONFLICT(id) DO NOTHING", [verifier]);
    const binding = (await client.query<{ verifier: Buffer }>("SELECT verifier FROM participant_password_key_binding WHERE id=1 FOR SHARE")).rows[0];
    if (!binding?.verifier.equals(verifier)) throw new Error("Kunci sandi fixture berbeda dari binding database uji.");
    const majorName = `LP${suffix}`;
    const majorId = (await client.query<{ id: string }>("INSERT INTO school_majors(name) VALUES($1) RETURNING id::text AS id", [majorName])).rows[0].id;
    const classId = (await client.query<{ id: string }>("INSERT INTO school_classes(level,major_id) VALUES('X',$1) RETURNING id::text AS id", [majorId])).rows[0].id;
    const settingYear = await client.query<{ id: string | null }>('SELECT active_year_id::text AS id FROM academic_year_settings WHERE id=1 FOR UPDATE');
    if (settingYear.rowCount !== 1 || settingYear.rows[0].id !== null) throw new Error("Tahun aktif database uji harus kosong sebelum fixture.");
    const yearId = (await client.query<{ id: string }>('INSERT INTO academic_years(name) VALUES($1) RETURNING id::text AS id', [`Fixture ${suffix}`])).rows[0].id;
    await client.query('UPDATE academic_year_settings SET active_year_id=$1,revision=revision+1 WHERE id=1', [yearId]);
    const periodAName = `Periode A ${suffix}`; const periodBName = `Periode B ${suffix}`;
    const periods = (await client.query<{ id: string; name: string }>(
      "INSERT INTO exam_periods(name,start_date,end_date,academic_year_id) VALUES($1,'2025-01-01','2025-12-31',$3),($2,'2027-01-01','2027-12-31',$3) RETURNING id::text AS id,name",
      [periodAName, periodBName, yearId],
    )).rows;
    const periodA = periods.find((p) => p.name === periodAName)!.id; const periodB = periods.find((p) => p.name === periodBName)!.id;
    const studentAName = `Peserta A ${suffix}`; const studentBName = `Peserta B ${suffix}`;
    const base = randomInt(0, 999_999_998);
    const students = (await client.query<{ id: string; name: string }>(
      "INSERT INTO school_students(name,nisn) VALUES($1,$2),($3,$4) RETURNING id::text AS id,name",
      [studentAName, String(base).padStart(10, "0"), studentBName, String(base + 1).padStart(10, "0")],
    )).rows;
    const studentA = students.find((s) => s.name === studentAName)!.id; const studentB = students.find((s) => s.name === studentBName)!.id;
    const placements = (await client.query<{ id: string; student: string }>(
      `INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot)
       VALUES($1,$2,$3,$4),($5,$6,$3,$4) RETURNING id::text AS id,student_id::text AS student`,
      [studentA, periodA, classId, `X ${majorName}`, studentB, periodB],
    )).rows;
    const placementA = placements.find((p) => p.student === studentA)!.id; const placementB = placements.find((p) => p.student === studentB)!.id;
    const identities = (await client.query<{ id: string; student: string }>(
      `INSERT INTO participant_identities(student_id,period_id,participant_number,username)
       VALUES($1,$2,$3,$4),($5,$6,$7,$4) RETURNING id::text AS id,student_id::text AS student`,
      [studentA, periodA, `N-A-${suffix}`, username, studentB, periodB, `N-B-${suffix}`],
    )).rows;
    const identityA = identities.find((i) => i.student === studentA)!.id; const identityB = identities.find((i) => i.student === studentB)!.id;
    for (const [identityId, periodId, password, hash] of [[identityA, periodA, passwordA, hashA], [identityB, periodB, passwordB, hashB]]) {
      const encrypted = encryptParticipantPassword(password, key, { identityId, periodId });
      await client.query("INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES($1,$2,$3,$4,$5)", [identityId, hash, encrypted.nonce, encrypted.ciphertext, encrypted.authenticationTag]);
    }
    const activeName = `Tes berlangsung ${suffix}`; const futureName = `Tes mendatang ${suffix}`; const pastName = `Tes lampau ${suffix}`; const hiddenName = `Tes rahasia periode B ${suffix}`;
    const exams = (await client.query<{ id: string; name: string }>(
      `INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES
        ($1,$3,clock_timestamp()-interval '5 minutes','WIB',90),
        ($1,$4,clock_timestamp()+interval '1 day','WITA',60),
        ($1,$5,clock_timestamp()-interval '1 day','WIT',60),
        ($2,$6,(date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Jakarta') + interval '12 hours') AT TIME ZONE 'Asia/Jakarta','WIB',60) RETURNING id::text AS id,name`,
      [periodA, periodB, activeName, futureName, pastName, hiddenName],
    )).rows;
    const activeTest = exams.find((e) => e.name === activeName)!.id;
    const topicId = (await client.query<{ id: string }>("INSERT INTO question_topics(name) VALUES($1) RETURNING id::text AS id", [`Topik login ${suffix}`])).rows[0].id;
    const questionSecret = `SOAL-RAHASIA-${suffix}`;
    const questionId = (await client.query<{ id: string }>(
      `INSERT INTO question_bank(topic_id,prompt_text,option_a_text,option_b_text,option_c_text,option_d_text,option_e_text,correct_option)
       VALUES($1,$2,'Pilihan A','Pilihan B','Pilihan C','Jawaban rahasia','Pilihan E','D') RETURNING id::text AS id`, [topicId, questionSecret],
    )).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)", [activeTest, questionId]);
    await seedPublishedSchedules(client, exams.filter((e) => e.name !== hiddenName).map((e) => e.id), studentA, placementA);
    await seedPublishedSchedules(client, exams.filter((e) => e.name === hiddenName).map((e) => e.id), studentB, placementB);
    const setting = await client.query<{ period: string | null }>('SELECT period_id::text AS period FROM participant_login_settings WHERE id=1 FOR UPDATE');
    if (setting.rowCount !== 1 || setting.rows[0].period !== null) throw new Error("Pengaturan DB uji harus tersedia dan tidak memiliki periode aktif sebelum fixture.");
    await client.query("UPDATE participant_login_settings SET period_id=$1 WHERE id=1", [periodA]);
    await client.query("COMMIT");
    return { suffix, username, passwordA, passwordB, periodA, periodB, periodAName, periodBName, yearId, majorId, classId, majorName,
      studentA, studentB, studentAName, studentBName, identityA, identityB, placementA, placementB,
      activeTest, activeName, futureName, pastName, hiddenName, questionId, topicId, questionSecret };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { key.fill(0); }
}

export async function cleanupLoginFixture(client: pg.Client, f: LoginFixture, extraBuckets: Array<{ period: string; username: string }> = []) {
  const periods = [f.periodA, f.periodB];
  await client.query("DELETE FROM participant_sessions WHERE participant_identity_id=ANY($1::bigint[])", [[f.identityA, f.identityB]]);
  await client.query("UPDATE participant_login_settings SET period_id=NULL WHERE id=1 AND period_id=ANY($1::bigint[])", [periods]);
  const buckets = [
    participantAttemptBucket(f.periodA, f.username.toLowerCase()), participantAttemptBucket(f.periodB, f.username.toLowerCase()),
    ...extraBuckets.map((item) => participantAttemptBucket(item.period, item.username.toLowerCase())),
  ];
  await client.query("DELETE FROM participant_login_attempts WHERE bucket_hash=ANY($1::bytea[])", [buckets]);
  await client.query("DELETE FROM participant_password_audit WHERE participant_identity_id=ANY($1::bigint[])", [[f.identityA, f.identityB]]);
  await client.query("DELETE FROM participant_passwords WHERE participant_identity_id=ANY($1::bigint[])", [[f.identityA, f.identityB]]);
  await client.query("DELETE FROM exam_token_issue_operations WHERE token_id IN (SELECT id FROM exam_access_tokens WHERE exam_test_id IN (SELECT id FROM exam_tests WHERE period_id=ANY($1::bigint[])))", [periods]);
  await client.query("DELETE FROM exam_access_tokens WHERE exam_test_id IN (SELECT id FROM exam_tests WHERE period_id=ANY($1::bigint[]))", [periods]);
  await client.query("DELETE FROM exam_schedule_runs WHERE period_id=ANY($1::bigint[])", [periods]);
  await client.query("DELETE FROM exam_session_assignments WHERE period_id=ANY($1::bigint[])", [periods]);
  await client.query("DELETE FROM exam_session_groups WHERE period_id=ANY($1::bigint[])", [periods]);
  await client.query("DELETE FROM exam_session_plans WHERE period_id=ANY($1::bigint[])", [periods]);
  await client.query("DELETE FROM exam_tests WHERE period_id=ANY($1::bigint[])", [periods]);
  await client.query("DELETE FROM question_bank WHERE id=$1::bigint", [f.questionId]);
  await client.query("DELETE FROM question_topics WHERE id=$1::bigint", [f.topicId]);
  await client.query("DELETE FROM participant_identities WHERE period_id=ANY($1::bigint[])", [periods]);
  await client.query("DELETE FROM student_class_placements WHERE period_id=ANY($1::bigint[])", [periods]);
  await client.query("DELETE FROM school_students WHERE id=ANY($1::bigint[])", [[f.studentA, f.studentB]]);
  await client.query("DELETE FROM school_classes WHERE id=$1::bigint", [f.classId]);
  await client.query("DELETE FROM school_majors WHERE id=$1::bigint", [f.majorId]);
  await client.query("DELETE FROM exam_periods WHERE id=ANY($1::bigint[])", [periods]);
  await client.query("UPDATE academic_year_settings SET active_year_id=NULL,revision=revision+1 WHERE id=1 AND active_year_id=$1::bigint", [f.yearId]);
  await client.query("DELETE FROM academic_years WHERE id=$1::bigint", [f.yearId]);
  await resetLoginGlobal(client);
}

export async function openParticipantLogin(page: Page, username: string, password: string) {
  await page.goto("/peserta/login");
  await page.getByLabel("Username peserta").fill(username);
  await page.getByLabel("Kata sandi", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk sebagai peserta" }).click();
}

export async function loginParticipant(page: Page, username: string, password: string) {
  await openParticipantLogin(page, username, password);
  await expect(page).toHaveURL(/\/peserta(?:\?|$)/);
  await expect(page.getByRole("heading", { name: /Halo,/ })).toBeVisible();
}

// Pembantu ini menguji tindakan admin sungguhan, bukan mengubah DB langsung.
export async function activateLoginPeriod(admin: Page, periodName: string) {
  await admin.goto("/data-peserta/periode");
  await admin.getByRole("button", { name: `Aktifkan login ${periodName}` }).click();
  const dialog = admin.getByRole("dialog", { name: "Aktifkan periode login?" });
  await expect(dialog).toContainText("Semua sesi peserta sebelumnya diakhiri");
  await dialog.getByRole("button", { name: "Ya, aktifkan login" }).click();
  await expect(dialog).toBeHidden();
}
