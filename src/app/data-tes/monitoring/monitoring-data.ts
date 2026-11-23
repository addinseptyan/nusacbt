import "server-only";
import type { PoolClient } from "pg";
import { lockActiveAdminSession } from "@/lib/admin-auth";
import { adminHasAnyPermission, adminHasPermission } from "@/lib/admin-permissions.mjs";
import type { MonitoringFilters, MonitoringKind, MonitoringStatus } from "@/lib/monitoring-filter.mjs";
import { getPostgresPool } from "@/lib/postgres";
import { loadFinalGradeData, type FinalGradeData } from "./final-grade-data";

export const MONITOR_PAGE_SIZE = 30;
export const MONITOR_MAX_EXPORT = 5000;
export class MonitoringSessionExpired extends Error {}
export class MonitoringPermissionDenied extends Error {}
export class MonitoringSizeExceeded extends Error {}
export type MonitoringRow = {
  id: string | null; studentId: string; runId: string; student: string; number: string | null; nisn: string; className: string;
  period: string; year: string | null; testName: string; label: string; kind: MonitoringKind; published: boolean;
  questionCount: number | null; correct: number | null; status: MonitoringStatus; started: string | null; scheduled: string;
  deadline: string | null; zone: string; elapsedSeconds: number | null; attemptNumber: number | null; latest: boolean;
  completed: boolean; withinWindow: boolean; permissionId: string | null; permissionStatus: "pending" | "consumed" | "revoked" | "expired" | null;
  grantedAt: string | null; grantedBy: string | null; actionAt: string | null; revokedBy: string | null; finalized: boolean; finalRevision: string;
};
export type MonitoringOption = { id: string; name: string; period: string; year: string | null };
export type MonitoringData = { rows: MonitoringRow[]; total: number; page: number; pages: number; final: FinalGradeData | null;
  options: { years: Array<{ id: string; name: string }>; tests: MonitoringOption[]; classes: string[] } | null };
const zones = { WIB: "Asia/Jakarta", WITA: "Asia/Makassar", WIT: "Asia/Jayapura" } as const;
const orderSql: Record<MonitoringFilters["order"], string> = {
  time_desc: 'sort_time DESC NULLS LAST', time_asc: 'sort_time ASC NULLS LAST',
  score_desc: 'score_raw DESC NULLS LAST', score_asc: 'score_raw ASC NULLS LAST',
  student_asc: 'lower(student) ASC', student_desc: 'lower(student) DESC',
  test_asc: 'lower("testName") ASC', test_desc: 'lower("testName") DESC',
};

// Satu baris untuk setiap pengerjaan; bila belum pernah mulai, satu baris
// roster pada pelaksanaan itu. Jadwal draf juga ditandai, tidak disamakan
// dengan jadwal yang sudah dirilis. Filter tanggal memakai tanggal jadwal.
const base = `WITH base AS (
  SELECT a.id::text AS id,rp.student_id::text AS "studentId",r.id::text AS "runId",
    COALESCE(a.student_name_snapshot,s.name) AS student,COALESCE(a.participant_number_snapshot,i.participant_number) AS number,s.nisn,
    COALESCE(a.class_name_snapshot,pl.class_name_snapshot) AS "className",p.name AS period,y.name AS year,
    COALESCE(a.test_name_snapshot,t.name) AS "testName",r.label,r.kind,(r.published_at IS NOT NULL) AS published,
    a.question_count AS "questionCount",a.correct_count AS correct,
    CASE WHEN a.id IS NULL THEN 'not_started' WHEN a.completed_at IS NOT NULL THEN a.completion_reason
      WHEN a.deadline<=now() THEN 'waiting' ELSE 'working' END AS status,
    to_char(a.started_at AT TIME ZONE $8::text,'DD/MM/YYYY HH24:MI:SS') AS started,
    to_char(r.starts_at AT TIME ZONE $8::text,'DD/MM/YYYY HH24:MI:SS') AS scheduled,
    to_char(a.deadline AT TIME ZONE $8::text,'DD/MM/YYYY HH24:MI:SS') AS deadline,$9::text AS zone,
    CASE WHEN a.id IS NULL THEN NULL ELSE GREATEST(0,extract(epoch FROM (COALESCE(a.completed_at,LEAST(now(),a.deadline))-a.started_at))::int) END AS "elapsedSeconds",
    CASE WHEN a.id IS NULL THEN NULL ELSE (SELECT count(*)::int FROM exam_attempts h WHERE h.run_id=a.run_id AND h.participant_identity_id=a.participant_identity_id AND h.id<=a.id) END AS "attemptNumber",
    a.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM exam_attempts h WHERE h.run_id=a.run_id AND h.participant_identity_id=a.participant_identity_id AND h.id>a.id) AS latest,
    (a.completed_at IS NOT NULL) AS completed,
    COALESCE(r.published_at IS NOT NULL AND r.starts_at<=now() AND r.starts_at+r.duration_minutes*interval '1 minute'>now() AND a.deadline>now(),false) AS "withinWindow",
    permission.id::text AS "permissionId",
    CASE WHEN permission.id IS NULL THEN NULL WHEN permission.revoked_at IS NOT NULL THEN 'revoked' WHEN permission.consumed_at IS NOT NULL THEN 'consumed'
      WHEN r.published_at IS NOT NULL AND r.starts_at<=now() AND r.starts_at+r.duration_minutes*interval '1 minute'>now() AND a.deadline>now() THEN 'pending' ELSE 'expired' END AS "permissionStatus",
    to_char(permission.granted_at AT TIME ZONE $8::text,'DD/MM/YYYY HH24:MI:SS') AS "grantedAt",
    to_char(COALESCE(permission.revoked_at,permission.consumed_at) AT TIME ZONE $8::text,'DD/MM/YYYY HH24:MI:SS') AS "actionAt",
    granted.username AS "grantedBy",revoker.username AS "revokedBy",(fg.finalized_at IS NOT NULL) AS finalized,COALESCE(fg.revision,0)::text AS "finalRevision",
    COALESCE(a.started_at,r.starts_at) AS sort_time,
    CASE WHEN a.completed_at IS NOT NULL THEN a.correct_count::numeric/a.question_count ELSE NULL END AS score_raw,
    p.academic_year_id AS year_id,t.id AS test_id,r.starts_at AS scheduled_at
  FROM exam_schedule_participants rp JOIN exam_schedule_runs r ON r.id=rp.run_id
  JOIN exam_tests t ON t.id=r.exam_test_id JOIN exam_periods p ON p.id=r.period_id
  LEFT JOIN academic_years y ON y.id=p.academic_year_id
  JOIN school_students s ON s.id=rp.student_id JOIN student_class_placements pl ON pl.id=rp.placement_id
  LEFT JOIN participant_identities i ON i.student_id=rp.student_id AND i.period_id=rp.period_id
  LEFT JOIN exam_attempts a ON a.run_id=rp.run_id AND a.student_id=rp.student_id
  LEFT JOIN exam_final_grade_state fg ON fg.exam_test_id=t.id AND fg.participant_identity_id=COALESCE(a.participant_identity_id,i.id)
  LEFT JOIN LATERAL (SELECT * FROM exam_retake_permissions x WHERE x.previous_attempt_id=a.id ORDER BY x.id DESC LIMIT 1) permission ON true
  LEFT JOIN admin_users granted ON granted.id=permission.granted_by LEFT JOIN admin_users revoker ON revoker.id=permission.revoked_by
), filtered AS (
  SELECT * FROM base WHERE ($1::bigint IS NULL OR year_id=$1::bigint) AND ($2::bigint IS NULL OR test_id=$2::bigint)
   AND ($3::text IS NULL OR "className"=$3::text) AND ($4::text IS NULL OR kind=$4::text)
   AND ($5::text IS NULL OR status=$5::text) AND ($6::timestamptz IS NULL OR scheduled_at >= $6::timestamptz)
   AND ($7::timestamptz IS NULL OR scheduled_at < $7::timestamptz)
)`;
function bindings(f: MonitoringFilters) { return [f.yearId,f.testId,f.className,f.kind,f.status,f.fromUtc,f.toUtcExclusive,zones[f.zone],f.zone]; }
async function options(client: PoolClient) {
  const years = (await client.query<{ id:string; name:string }>("SELECT id::text AS id,name FROM academic_years ORDER BY name DESC,id DESC")).rows;
  const tests = (await client.query<MonitoringOption>(`SELECT t.id::text AS id,t.name,p.name AS period,y.name AS year FROM exam_tests t JOIN exam_periods p ON p.id=t.period_id LEFT JOIN academic_years y ON y.id=p.academic_year_id ORDER BY p.start_date DESC,lower(t.name),t.id`)).rows;
  const classes = (await client.query<{ name: string }>(`SELECT DISTINCT COALESCE(a.class_name_snapshot,pl.class_name_snapshot) AS name
    FROM exam_schedule_participants rp JOIN student_class_placements pl ON pl.id=rp.placement_id LEFT JOIN exam_attempts a ON a.run_id=rp.run_id AND a.student_id=rp.student_id ORDER BY name`)).rows.map((r) => r.name);
  return { years, tests, classes };
}
async function read(client: PoolClient, f: MonitoringFilters, requestedPage: number, finalPage: number, exporting: boolean): Promise<MonitoringData> {
  const list = exporting ? null : await options(client); const params = bindings(f);
  const total = (await client.query<{ count:number }>(`${base} SELECT count(*)::int AS count FROM filtered`, params)).rows[0].count;
  if (exporting && total > MONITOR_MAX_EXPORT) throw new MonitoringSizeExceeded(`Maksimal ${MONITOR_MAX_EXPORT} baris per unduhan; sempitkan filter.`);
  const pages = Math.max(1, Math.ceil(total / MONITOR_PAGE_SIZE)); const page = exporting ? 1 : Math.min(Math.max(requestedPage,1),pages);
  const rows = (await client.query<MonitoringRow>(`${base} SELECT * FROM filtered ORDER BY ${orderSql[f.order]},"runId","studentId",id NULLS LAST LIMIT $10::int OFFSET $11::int`,
    [...params, exporting ? MONITOR_MAX_EXPORT : MONITOR_PAGE_SIZE, exporting ? 0 : (page-1)*MONITOR_PAGE_SIZE])).rows;
  const final = !exporting && f.testId && list?.tests.some((t) => t.id === f.testId) ? await loadFinalGradeData(client, f.testId, finalPage) : null;
  return { rows,total,page,pages,final,options:list };
}
export async function withMonitoringSnapshot<T>(f: MonitoringFilters, page: number, finalPage: number, exporting: boolean, render: (data: MonitoringData) => T): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const admin = await lockActiveAdminSession(client); if (!admin) throw new MonitoringSessionExpired();
    const canRead = exporting
      ? adminHasPermission(admin, "monitoring.view")
      : adminHasAnyPermission(admin, ["monitoring.view", "grading_overrides.manage"]);
    if (!canRead) throw new MonitoringPermissionDenied();
    const data = await read(client,f,page,finalPage,exporting); const result = render(data);
    const active = await lockActiveAdminSession(client); if (!active || active.id !== admin.id) throw new MonitoringSessionExpired();
    const stillAllowed = exporting
      ? adminHasPermission(active, "monitoring.view")
      : adminHasAnyPermission(active, ["monitoring.view", "grading_overrides.manage"]);
    if (!stillAllowed) throw new MonitoringPermissionDenied();
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
}
