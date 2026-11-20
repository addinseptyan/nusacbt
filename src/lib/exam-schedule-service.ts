import "server-only";
import type { PoolClient } from "pg";

import { lockActiveAdminSession } from "@/lib/admin-auth";
import { lockSchedulePeriod } from "@/lib/exam-session-service";
import { validateExamRun, validateExamRunOperation } from "@/lib/exam-schedule-validation.mjs";
import type { ScheduleActionResult } from "@/lib/exam-session-types";
import { getPostgresPool } from "@/lib/postgres";

class ScheduleProblem extends Error {
  constructor(message: string, readonly reload = false) { super(message); }
}
type Draft = Extract<ReturnType<typeof validateExamRun>, { ok: true }>["value"];
type RunOperation = Extract<ReturnType<typeof validateExamRunOperation>, { ok: true }>["value"];
type LockedTest = { id: string; periodId: string; revision: string; durationMinutes: number; questionCount: number };
type LockedRun = { id: string; revision: string; kind: "regular" | "makeup" | "remedial"; sessionNumber: number | null; startsAt: Date; durationMinutes: number; questionMode: "inherit" | "custom"; publishedAt: Date | null };
function sqlCode(error: unknown) { return typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""; }
function constraint(error: unknown) { return typeof error === "object" && error !== null && "constraint" in error ? String(error.constraint) : ""; }

async function lockTest(client: PoolClient, testId: string, expectedRevision: string): Promise<LockedTest> {
  const initial = await client.query<{ periodId: string }>('SELECT period_id::text AS "periodId" FROM exam_tests WHERE id=$1::bigint', [testId]);
  const periodId = initial.rows[0]?.periodId;
  if (!periodId || !await lockSchedulePeriod(client, periodId)) throw new ScheduleProblem("Tes atau periode sudah dihapus. Muat ulang halaman.", true);
  const result = await client.query<Omit<LockedTest, "questionCount">>(
    'SELECT id::text AS id,period_id::text AS "periodId",xmin::text AS revision,duration_minutes AS "durationMinutes" FROM exam_tests WHERE id=$1::bigint FOR UPDATE', [testId],
  );
  const row = result.rows[0];
  if (!row || row.periodId !== periodId || row.revision !== expectedRevision) throw new ScheduleProblem("Rancangan tes sudah berubah. Muat ulang dan periksa kembali.", true);
  const count = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM exam_test_questions WHERE exam_test_id=$1::bigint", [testId]);
  return { ...row, questionCount: count.rows[0].n };
}

async function lockRun(client: PoolClient, test: LockedTest, runId: string, revision: string): Promise<LockedRun> {
  const result = await client.query<LockedRun>(
    `SELECT id::text AS id,xmin::text AS revision,kind,session_number AS "sessionNumber",starts_at AS "startsAt",
      duration_minutes AS "durationMinutes",question_mode AS "questionMode",published_at AS "publishedAt"
     FROM exam_schedule_runs WHERE id=$1::bigint AND exam_test_id=$2::bigint FOR UPDATE`, [runId, test.id],
  );
  if (!result.rows[0] || result.rows[0].revision !== revision) throw new ScheduleProblem("Pelaksanaan telah berubah atau dihapus. Muat ulang dan periksa kembali.", true);
  return result.rows[0];
}

async function verifyPlanRevision(client: PoolClient, periodId: string, expected: string | null) {
  const result = await client.query<{ revision: string }>("SELECT revision::text AS revision FROM exam_session_plans WHERE period_id=$1::bigint", [periodId]);
  if (expected === null || result.rows[0]?.revision !== expected) {
    throw new ScheduleProblem("Kelompok sesi telah berubah. Muat ulang dan periksa jumlah serta daftar peserta sebelum melanjutkan.", true);
  }
}

async function lockStudents(client: PoolClient, ids: string[], publishing = false) {
  if (!ids.length) return;
  // FOR UPDATE saat rilis menserialkan rilis lintas periode bagi siswa yang
  // sama. Pengurutan ID mencegah kebuntuan antar daftar yang saling beririsan.
  const result = await client.query(`SELECT id FROM school_students WHERE id=ANY($1::bigint[]) ORDER BY id ${publishing ? "FOR UPDATE" : "FOR SHARE"}`, [ids]);
  if (result.rowCount !== ids.length) throw new ScheduleProblem("Ada siswa yang tidak ditemukan. Muat ulang halaman.", true);
}

async function verifyDraftParticipants(client: PoolClient, test: LockedTest, draft: Draft) {
  const ids = draft.participants.map((p) => p.studentId);
  await lockStudents(client, ids);
  if (ids.length) {
    const placements = await client.query<{ studentId: string; placementId: string }>(
      `SELECT student_id::text AS "studentId",id::text AS "placementId" FROM student_class_placements
       WHERE period_id=$1::bigint AND student_id=ANY($2::bigint[]) AND ended_at IS NULL ORDER BY student_id FOR SHARE`, [test.periodId, ids],
    );
    const active = new Map(placements.rows.map((p) => [p.studentId,p.placementId]));
    if (draft.participants.some((p) => active.get(p.studentId) !== p.placementId)) throw new ScheduleProblem("Penempatan peserta berubah atau tidak aktif. Muat ulang dan periksa daftar.", true);
  }
  if (draft.kind === "regular") {
    const group = await client.query<{ capacity: number }>("SELECT capacity FROM exam_session_groups WHERE period_id=$1::bigint AND session_number=$2::smallint", [test.periodId, draft.sessionNumber]);
    if (!group.rowCount) throw new ScheduleProblem("Kelompok sesi belum tersedia. Atur pembagian sesi periode terlebih dahulu.", true);
    const assignments = await client.query<{ studentId: string }>(
      'SELECT student_id::text AS "studentId" FROM exam_session_assignments WHERE period_id=$1::bigint AND session_number=$2::smallint AND student_id=ANY($3::bigint[])',
      [test.periodId,draft.sessionNumber,ids],
    );
    if (assignments.rowCount !== ids.length || ids.length > group.rows[0].capacity) throw new ScheduleProblem("Siswa harus berada dalam kelompok sesi yang dipilih dan tidak melebihi kapasitas. Muat ulang.", true);
  }
}

async function verifyCustomQuestions(client: PoolClient, test: LockedTest, draft: Draft) {
  if (draft.questionMode !== "custom") return;
  if (draft.questions.length > test.questionCount) throw new ScheduleProblem("Jumlah soal remidi tidak boleh lebih banyak dari soal reguler.");
  if (!draft.questions.length) return;
  const rows = await client.query<{ id: string; revision: string }>(
    'SELECT id::text AS id,xmin::text AS revision FROM question_bank WHERE id=ANY($1::bigint[]) ORDER BY id FOR SHARE', [draft.questions.map((q) => q.id)],
  );
  const actual = new Map(rows.rows.map((q) => [q.id,q.revision]));
  if (draft.questions.some((q) => actual.get(q.id) !== q.revision)) throw new ScheduleProblem("Soal remidi telah berubah. Muat ulang dan periksa pilihan soal.", true);
}

function problemResult(error: unknown): ScheduleActionResult {
  if (error instanceof ScheduleProblem) return {ok:false,error:error.message,reload:error.reload};
  if (sqlCode(error) === "23505" && ["exam_schedule_regular_group_unique", "exam_schedule_one_regular_per_test_idx"].includes(constraint(error))) {
    return {ok:false,error:"Sesi reguler ini sudah ada atau seorang siswa sudah dipilih pada sesi reguler lain untuk tes yang sama. Muat ulang dan periksa.",reload:true};
  }
  if (["23503","23001","23505","40001","40P01"].includes(sqlCode(error))) return {ok:false,error:"Data berubah atau masih digunakan. Tidak ada perubahan yang disimpan; muat ulang dan periksa kembali.",reload:true};
  return {ok:false,error:"Hasil perubahan belum dapat dipastikan. Periksa koneksi dan muat ulang sebelum mencoba lagi.",reload:true};
}

export async function saveExamRunValue(raw: unknown): Promise<ScheduleActionResult> {
  const parsed = validateExamRun(raw); if (!parsed.ok) return parsed;
  const draft = parsed.value; let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect(); await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client); if (!admin) throw new ScheduleProblem("Sesi admin berakhir. Masuk kembali.");
    const test = await lockTest(client,draft.testId,draft.testRevision);
    let run: LockedRun | null = null;
    if (draft.runId && draft.runRevision) {
      run = await lockRun(client,test,draft.runId,draft.runRevision);
      if (run.publishedAt) throw new ScheduleProblem("Tarik rilis pelaksanaan sebelum mengubahnya.",true);
      if (run.kind !== draft.kind) throw new ScheduleProblem("Jenis pelaksanaan tidak dapat diubah. Buat pelaksanaan baru.");
    }
    if (draft.kind !== "remedial" && draft.durationMinutes !== test.durationMinutes) throw new ScheduleProblem("Durasi reguler dan susulan harus sama dengan rancangan tes. Muat ulang halaman.",true);
    if (draft.kind === "regular") await verifyPlanRevision(client,test.periodId,draft.planRevision);
    await verifyDraftParticipants(client,test,draft);
    await verifyCustomQuestions(client,test,draft);
    let id: string;
    if (run) {
      await client.query("DELETE FROM exam_schedule_participants WHERE run_id=$1::bigint",[run.id]);
      await client.query("DELETE FROM exam_schedule_custom_questions WHERE run_id=$1::bigint",[run.id]);
      const changed=await client.query<{id:string}>(
        `UPDATE exam_schedule_runs SET label=$2,session_number=$3::smallint,starts_at=$4::timestamptz,time_zone=$5,
          duration_minutes=$6,question_mode=$7,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
         WHERE id=$1::bigint RETURNING id::text AS id`,
        [run.id,draft.label,draft.sessionNumber,draft.startsAt,draft.timeZone,draft.durationMinutes,draft.questionMode],
      );
      id=changed.rows[0].id;
    } else {
      const created=await client.query<{id:string}>(
        `INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,session_number,starts_at,time_zone,duration_minutes,question_mode,created_by)
         VALUES($1::bigint,$2::bigint,$3,$4,$5::smallint,$6::timestamptz,$7,$8,$9,$10::bigint) RETURNING id::text AS id`,
        [test.id,test.periodId,draft.kind,draft.label,draft.sessionNumber,draft.startsAt,draft.timeZone,draft.durationMinutes,draft.questionMode,admin.id],
      );
      id=created.rows[0].id;
    }
    if (draft.participants.length) await client.query(
      `INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id)
       SELECT $1::bigint,$2::bigint,$3::bigint,$4,x.student_id,x.placement_id FROM unnest($5::bigint[],$6::bigint[]) AS x(student_id,placement_id)`,
      [id,test.id,test.periodId,draft.kind,draft.participants.map((p)=>p.studentId),draft.participants.map((p)=>p.placementId)],
    );
    if (draft.questions.length) await client.query(
      `INSERT INTO exam_schedule_custom_questions(run_id,question_id,position)
       SELECT $1::bigint,question_id,ordinality::integer FROM unnest($2::bigint[]) WITH ORDINALITY AS q(question_id,ordinality)`, [id,draft.questions.map((q)=>q.id)],
    );
    const stillActive=await lockActiveAdminSession(client); if (!stillActive || stillActive.id!==admin.id) throw new ScheduleProblem("Sesi admin berakhir. Masuk kembali.");
    await client.query("COMMIT");
    return {ok:true,message:run ? "Draf pelaksanaan diperbarui; belum dirilis." : "Draf pelaksanaan ditambahkan; belum dirilis."};
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(()=>{}); return problemResult(error);
  } finally { client?.release(); }
}

async function validatePublication(client: PoolClient, test: LockedTest, run: LockedRun) {
  if (test.questionCount < 1) throw new ScheduleProblem("Rancangan tes belum memiliki soal. Tambahkan soal sebelum merilis.");
  if (run.kind !== "remedial" && run.durationMinutes !== test.durationMinutes) throw new ScheduleProblem("Durasi reguler/susulan tidak sesuai rancangan. Perbaiki draf dahulu.",true);
  if (run.questionMode === "custom") {
    const count=(await client.query<{n:number}>("SELECT count(*)::int AS n FROM exam_schedule_custom_questions WHERE run_id=$1::bigint",[run.id])).rows[0].n;
    if (count < 1 || count > test.questionCount) throw new ScheduleProblem("Soal remidi harus diisi dan jumlahnya tidak boleh melebihi soal reguler.");
  }
  const roster=(await client.query<{studentId:string}>(
    'SELECT student_id::text AS "studentId" FROM exam_schedule_participants WHERE run_id=$1::bigint ORDER BY student_id', [run.id],
  )).rows;
  if (!roster.length) throw new ScheduleProblem("Pilih setidaknya satu peserta sebelum merilis.");
  const ids=roster.map((p)=>p.studentId); await lockStudents(client,ids,true);
  const active=await client.query<{studentId:string}>(
    `SELECT student_id::text AS "studentId" FROM student_class_placements WHERE period_id=$1::bigint AND student_id=ANY($2::bigint[])
     AND ended_at IS NULL ORDER BY student_id FOR SHARE`, [test.periodId,ids],
  );
  if (active.rowCount !== ids.length) throw new ScheduleProblem("Ada peserta tanpa kelas aktif. Perbaiki penempatan atau daftar sebelum merilis.",true);
  if (run.kind === "regular") {
    const group=await client.query<{capacity:number}>("SELECT capacity FROM exam_session_groups WHERE period_id=$1::bigint AND session_number=$2::smallint",[test.periodId,run.sessionNumber]);
    const matches=await client.query(
      "SELECT student_id FROM exam_session_assignments WHERE period_id=$1::bigint AND session_number=$2::smallint AND student_id=ANY($3::bigint[])",[test.periodId,run.sessionNumber,ids],
    );
    if (!group.rowCount || matches.rowCount!==ids.length || ids.length>group.rows[0].capacity) throw new ScheduleProblem("Pembagian sesi berubah atau kapasitas tidak cukup. Perbarui pelaksanaan sebelum merilis.",true);
  }
  // Lock siswa (di atas) menyerialkan rilis untuk orang yang sama bahkan
  // lintas periode. Interval setengah terbuka mengizinkan sesi berurutan.
  const conflict=await client.query(
    `SELECT 1 FROM exam_schedule_participants p JOIN exam_schedule_runs r ON r.id=p.run_id
     WHERE p.student_id=ANY($1::bigint[]) AND r.id<>$2::bigint AND r.published_at IS NOT NULL
       AND r.starts_at < $3::timestamptz + $4::integer * interval '1 minute'
       AND $3::timestamptz < r.starts_at + r.duration_minutes * interval '1 minute' LIMIT 1`,
    [ids,run.id,run.startsAt,run.durationMinutes],
  );
  if (conflict.rowCount) throw new ScheduleProblem("Ada peserta dengan jadwal lain yang sudah dirilis dan waktunya bertabrakan. Sesuaikan waktu atau peserta sebelum merilis.",true);
}

export async function changeExamRunValue(raw: unknown): Promise<ScheduleActionResult> {
  const parsed=validateExamRunOperation(raw); if (!parsed.ok) return parsed;
  const request: RunOperation=parsed.value; let client: PoolClient | undefined;
  try {
    client=await getPostgresPool().connect(); await client.query("BEGIN");
    const admin=await lockActiveAdminSession(client); if (!admin) throw new ScheduleProblem("Sesi admin berakhir. Masuk kembali.");
    const test=await lockTest(client,request.testId,request.testRevision);
    const run=await lockRun(client,test,request.runId,request.runRevision);
    if (request.operation==="publish") {
      if (run.publishedAt) throw new ScheduleProblem("Pelaksanaan sudah dirilis. Muat ulang halaman.",true);
      if (run.kind === "regular") await verifyPlanRevision(client,test.periodId,request.planRevision);
      await validatePublication(client,test,run);
      await client.query("UPDATE exam_schedule_runs SET published_at=clock_timestamp(),published_by=$2::bigint,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=$1::bigint",[run.id,admin.id]);
    } else if (request.operation==="unpublish") {
      if (!run.publishedAt) throw new ScheduleProblem("Pelaksanaan belum dirilis. Muat ulang halaman.",true);
      await client.query("UPDATE exam_schedule_runs SET published_at=NULL,published_by=NULL,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=$1::bigint",[run.id]);
    } else {
      if (run.publishedAt) throw new ScheduleProblem("Tarik rilis sebelum menghapus pelaksanaan.");
      await client.query("DELETE FROM exam_schedule_runs WHERE id=$1::bigint",[run.id]);
    }
    const stillActive=await lockActiveAdminSession(client); if (!stillActive || stillActive.id!==admin.id) throw new ScheduleProblem("Sesi admin berakhir. Masuk kembali.");
    await client.query("COMMIT");
    return {ok:true,message:request.operation==="publish" ? "Jadwal dirilis untuk peserta yang dipilih." : request.operation==="unpublish" ? "Rilis ditarik; jadwal tidak lagi tampil bagi peserta." : "Draf pelaksanaan dihapus."};
  } catch (error) { if (client) await client.query("ROLLBACK").catch(()=>{}); return problemResult(error); }
  finally { client?.release(); }
}
