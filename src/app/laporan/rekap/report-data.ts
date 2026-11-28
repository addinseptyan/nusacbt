import "server-only";

import type { PoolClient } from "pg";

import { lockActiveAdminSession } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { calculateFinalGrade, type FinalGradeMethod } from "@/lib/exam-final-grade.mjs";
import { gradeExamCounts } from "@/lib/exam-grading.mjs";
import { getPostgresPool } from "@/lib/postgres";
import type { ReportFilters, ReportZone } from "@/lib/report-filter.mjs";

export const REPORT_PAGE_SIZE = 25;
export const REPORT_MAX_EXPORT_PAIRS = 2000;
export const REPORT_MAX_ATTEMPTS = 10_000;
export class ReportSessionExpired extends Error {}
export class ReportPermissionDenied extends Error {}
export class ReportSizeExceeded extends Error {}

const zones: Record<ReportZone, string> = { WIB: "Asia/Jakarta", WITA: "Asia/Makassar", WIT: "Asia/Jayapura" };
type Kind = "regular" | "makeup" | "remedial";
type PairDb = { testId: string; identityId: string; student: string; number: string; className: string; testName: string; testTags: string[];
  period: string; nisn: string; method: FinalGradeMethod; finalized: boolean; finalizedAt: string | null; matchedAt: string };
type AttemptDb = { id: string; testId: string; identityId: string; student: string; number: string; className: string;
  testName: string; testTags: string[]; label: string; kind: Kind; runZone: ReportZone; attemptNumber: number; started: string; completed: string;
  reason: "submitted" | "time_expired"; correct: number; answered: number; questions: number; matches: boolean };
export type ReportAttempt = AttemptDb & { score: number };
export type ReportRow = PairDb & { score: number; unfinished: number; attempts: ReportAttempt[] };
export type ReportOptions = { periods: Array<{ id: string; name: string }>; tests: Array<{ id: string; name: string; period: string }>;
  classes: string[] };
export type ReportData = { rows: ReportRow[]; total: number; page: number; pages: number; options: ReportOptions | null; zone: ReportZone; sizeWarning: string | null };

const condition = `a.completed_at IS NOT NULL
  AND ($1::bigint IS NULL OR a.period_id=$1::bigint)
  AND ($2::bigint IS NULL OR a.exam_test_id=$2::bigint)
  AND ($3::text IS NULL OR a.class_name_snapshot=$3::text)
  AND ($4::text IS NULL OR strpos(lower(a.student_name_snapshot),lower($4::text))>0
    OR strpos(lower(a.participant_number_snapshot),lower($4::text))>0 OR strpos(st.nisn,$4::text)>0)
  AND ($5::timestamptz IS NULL OR a.completed_at >= $5::timestamptz)
  AND ($6::timestamptz IS NULL OR a.completed_at < $6::timestamptz)`;

// Semua filter, termasuk kelas dan tanggal, harus cocok pada pengerjaan yang
// sama. Satu pasangan muncul satu kali, dengan snapshot cocok yang terbaru.
const matched = `WITH matched AS (
  SELECT DISTINCT ON (a.exam_test_id,a.participant_identity_id)
    a.exam_test_id,a.participant_identity_id,a.period_id,a.student_id,a.student_name_snapshot,
    a.participant_number_snapshot,a.class_name_snapshot,a.test_name_snapshot,a.completed_at,a.id
  FROM exam_attempts a JOIN school_students st ON st.id=a.student_id
  WHERE ${condition}
  ORDER BY a.exam_test_id,a.participant_identity_id,a.completed_at DESC,a.id DESC
)`;

function values(f: ReportFilters) { return [f.periodId, f.testId, f.className, f.student, f.fromUtc, f.toUtcExclusive]; }

async function loadOptions(client: PoolClient): Promise<ReportOptions> {
  const periods = (await client.query<{ id: string; name: string }>(
    `SELECT id::text AS id,name FROM exam_periods ORDER BY start_date DESC,id DESC`,
  )).rows;
  const tests = (await client.query<{ id: string; name: string; period: string }>(
    `SELECT t.id::text AS id,t.name,p.name AS period FROM exam_tests t JOIN exam_periods p ON p.id=t.period_id
     ORDER BY p.start_date DESC,t.name,t.id`,
  )).rows;
  const classes = (await client.query<{ name: string }>(
    `SELECT DISTINCT class_name_snapshot AS name FROM exam_attempts WHERE completed_at IS NOT NULL ORDER BY name`,
  )).rows.map((r) => r.name);
  return { periods, tests, classes };
}

async function readReport(client: PoolClient, f: ReportFilters, requestedPage: number, exporting: boolean): Promise<ReportData> {
  const options = exporting ? null : await loadOptions(client);
  const bindings = values(f);
  const total = (await client.query<{ total: number }>(`${matched} SELECT count(*)::int AS total FROM matched`, bindings)).rows[0].total;
  if (exporting && total > REPORT_MAX_EXPORT_PAIRS) {
    throw new ReportSizeExceeded(`Terlalu banyak hasil untuk satu unduhan (maksimal ${REPORT_MAX_EXPORT_PAIRS} pasangan tes/peserta). Sempitkan filter.`);
  }
  const pages = Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE));
  const page = exporting ? 1 : Math.min(Math.max(1, requestedPage), pages);
  const limit = exporting ? REPORT_MAX_EXPORT_PAIRS : REPORT_PAGE_SIZE;
  const pairRows = (await client.query<PairDb>(`${matched}
    SELECT m.exam_test_id::text AS "testId",m.participant_identity_id::text AS "identityId",
      m.student_name_snapshot AS student,m.participant_number_snapshot AS number,m.class_name_snapshot AS "className",
      m.test_name_snapshot AS "testName",COALESCE(t.tags,ARRAY[]::text[]) AS "testTags",p.name AS period,st.nisn,
      COALESCE(settings.method,'highest') AS method,(state.finalized_at IS NOT NULL) AS finalized,
      to_char(state.finalized_at AT TIME ZONE $9::text,'YYYY-MM-DD HH24:MI:SS') AS "finalizedAt",
      to_char(m.completed_at AT TIME ZONE $9::text,'YYYY-MM-DD HH24:MI:SS') AS "matchedAt"
    FROM matched m JOIN exam_periods p ON p.id=m.period_id JOIN school_students st ON st.id=m.student_id
    LEFT JOIN exam_tests t ON t.id=m.exam_test_id
    LEFT JOIN exam_final_grade_settings settings ON settings.exam_test_id=m.exam_test_id
    LEFT JOIN exam_final_grade_state state ON state.exam_test_id=m.exam_test_id AND state.participant_identity_id=m.participant_identity_id
    ORDER BY m.completed_at DESC,m.exam_test_id,m.participant_identity_id
    LIMIT $7::integer OFFSET $8::integer`, [...bindings, limit, (page - 1) * REPORT_PAGE_SIZE, zones[f.zone]])).rows;
  if (!pairRows.length) return { rows: [], total, page, pages, options, zone: f.zone, sizeWarning: null };
  const tests = pairRows.map((r) => r.testId); const identities = pairRows.map((r) => r.identityId);
  const unfinished = (await client.query<{ testId: string; identityId: string; count: number }>(
    `WITH selected AS (SELECT * FROM unnest($1::bigint[],$2::bigint[]) AS x(test_id,identity_id))
     SELECT a.exam_test_id::text AS "testId",a.participant_identity_id::text AS "identityId",
       count(*) FILTER (WHERE a.completed_at IS NULL)::int AS count
     FROM exam_attempts a JOIN selected s ON s.test_id=a.exam_test_id AND s.identity_id=a.participant_identity_id
     GROUP BY a.exam_test_id,a.participant_identity_id`, [tests, identities],
  )).rows;
  // Seluruh bukti selesai diambil SETELAH pemilihan pasangan, bukan dibatasi
  // rentang, agar nilai akhir tidak berubah karena filter laporan.
  const attempts = (await client.query<AttemptDb>(
    `WITH selected AS (SELECT * FROM unnest($1::bigint[],$2::bigint[]) AS x(test_id,identity_id)),
     ordered AS (
       SELECT a.*,st.nisn,row_number() OVER (PARTITION BY a.run_id,a.participant_identity_id ORDER BY a.id)::int AS attempt_number
       FROM exam_attempts a JOIN selected s ON s.test_id=a.exam_test_id AND s.identity_id=a.participant_identity_id
       JOIN school_students st ON st.id=a.student_id
     )
     SELECT a.id::text AS id,a.exam_test_id::text AS "testId",a.participant_identity_id::text AS "identityId",
       a.student_name_snapshot AS student,a.participant_number_snapshot AS number,a.class_name_snapshot AS "className",
       a.test_name_snapshot AS "testName",COALESCE(t.tags,ARRAY[]::text[]) AS "testTags",a.run_label_snapshot AS label,a.kind,a.time_zone_snapshot AS "runZone",
       a.attempt_number AS "attemptNumber",to_char(a.started_at AT TIME ZONE $7::text,'YYYY-MM-DD HH24:MI:SS') AS started,
       to_char(a.completed_at AT TIME ZONE $7::text,'YYYY-MM-DD HH24:MI:SS') AS completed,
       a.completion_reason AS reason,a.correct_count AS correct,a.answered_count AS answered,a.question_count AS questions,
       (($3::text IS NULL OR a.class_name_snapshot=$3::text)
        AND ($4::text IS NULL OR strpos(lower(a.student_name_snapshot),lower($4::text))>0
          OR strpos(lower(a.participant_number_snapshot),lower($4::text))>0 OR strpos(a.nisn,$4::text)>0)
        AND ($5::timestamptz IS NULL OR a.completed_at >= $5::timestamptz)
        AND ($6::timestamptz IS NULL OR a.completed_at < $6::timestamptz)) AS matches
     FROM ordered a LEFT JOIN exam_tests t ON t.id=a.exam_test_id WHERE a.completed_at IS NOT NULL
     ORDER BY a.exam_test_id,a.participant_identity_id,a.id
     LIMIT $8::integer`, [tests, identities, f.className, f.student, f.fromUtc, f.toUtcExclusive, zones[f.zone], REPORT_MAX_ATTEMPTS + 1],
  )).rows;
  if (attempts.length > REPORT_MAX_ATTEMPTS) {
    const message = `Terlalu banyak rincian pengerjaan (maksimal ${REPORT_MAX_ATTEMPTS}). Pilih tes atau peserta lain, atau sempitkan filter.`;
    if (exporting) throw new ReportSizeExceeded(message);
    // Tetap tampilkan formulir filter, tetapi jangan mengirim hasil parsial.
    return { rows: [], total, page, pages, options, zone: f.zone, sizeWarning: message };
  }
  const key = (test: string, identity: string) => `${test}:${identity}`;
  const byPair = new Map<string, ReportAttempt[]>();
  for (const item of attempts) {
    const score = gradeExamCounts(item.correct, item.questions);
    if (!score.ok) throw new Error("Nilai pengerjaan tidak valid.");
    const k = key(item.testId, item.identityId); const entries = byPair.get(k) ?? [];
    entries.push({ ...item, score: score.hundredths / 100 }); byPair.set(k, entries);
  }
  const unfinishedByPair = new Map(unfinished.map((r) => [key(r.testId, r.identityId), r.count]));
  const rows = pairRows.map((pair): ReportRow => {
    const k = key(pair.testId, pair.identityId); const evidence = byPair.get(k) ?? [];
    const score = calculateFinalGrade(pair.method, evidence.map((a) => ({ correctCount: a.correct, questionCount: a.questions })));
    if (score === null) throw new Error("Nilai akhir tidak dapat dihitung dari bukti selesai.");
    return { ...pair, score, unfinished: unfinishedByPair.get(k) ?? 0, attempts: evidence };
  });
  return { rows, total, page, pages, options, zone: f.zone, sizeWarning: null };
}

/** Pembacaan dan pembuatan dokumen berada pada snapshot yang sama. */
export async function withReportSnapshot<T>(
  filters: ReportFilters, page: number, exporting: boolean, render: (data: ReportData) => T | Promise<T>,
): Promise<T> {
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new ReportSessionExpired();
    if (!adminHasPermission(admin, "reports.view")) throw new ReportPermissionDenied();
    const data = await readReport(client, filters, page, exporting);
    const result = await render(data);
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new ReportSessionExpired();
    if (!adminHasPermission(active, "reports.view")) throw new ReportPermissionDenied();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client?.release(); }
}
