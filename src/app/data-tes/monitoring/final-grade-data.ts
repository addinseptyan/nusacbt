import "server-only";

import type { PoolClient } from "pg";
import { calculateFinalGrade, formatFinalGrade, type FinalGradeMethod } from "@/lib/exam-final-grade.mjs";
import { finalGradeEvidenceDigest, type FinalEvidence } from "@/lib/exam-final-grade-server";

const PAGE_SIZE = 30;
type Kind = FinalEvidence["kind"];
type RawRow = { identityId: string; student: string; number: string; className: string; finished: number; unfinished: number;
  evidence: FinalEvidence[]; pendingPermissions: number; finalized: boolean; revision: string };
export type FinalGradeRow = Omit<RawRow, "evidence"> & { digest: string; score: string | null; kinds: Kind[]; hiddenKinds: Kind[] };
type AuditRow = { action: "method" | "finalize" | "reopen"; oldValue: string; newValue: string; actor: string | null;
  time: string; student: string | null; number: string | null; recordedMethod: FinalGradeMethod | null;
  recordedHundredths: number | null; recordedAttemptCount: number | null; revoked: number | null };
export type FinalGradeData = { method: FinalGradeMethod; methodRevision: string; rows: FinalGradeRow[]; total: number; page: number; pages: number; audit: AuditRow[] };

/** Dipanggil dalam transaksi snapshot monitoring, bukan dengan koneksi berbeda. */
export async function loadFinalGradeData(client: PoolClient, testId: string, requestedPage: number): Promise<FinalGradeData> {
  const setting = (await client.query<{ method: FinalGradeMethod; revision: string }>(
    `SELECT COALESCE(s.method,'highest') AS method,COALESCE(s.revision,0)::text AS revision
     FROM exam_tests t LEFT JOIN exam_final_grade_settings s ON s.exam_test_id=t.id WHERE t.id=$1::bigint`, [testId],
  )).rows[0];
  if (!setting) throw new Error("Tes tidak ditemukan.");
  const visibility = (await client.query<{ kind: Kind; visible: boolean }>("SELECT kind,visible_to_participants AS visible FROM exam_score_category_visibility")).rows;
  const total = (await client.query<{ total: number }>(
    "SELECT count(DISTINCT participant_identity_id)::int AS total FROM exam_attempts WHERE exam_test_id=$1::bigint", [testId],
  )).rows[0].total;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE)); const page = Math.min(requestedPage, pages);
  const rows = (await client.query<RawRow>(
    `WITH people AS (
       SELECT participant_identity_id,max(id) AS latest_id FROM exam_attempts
       WHERE exam_test_id=$1::bigint GROUP BY participant_identity_id
     ), paged AS (
       SELECT p.participant_identity_id,a.student_name_snapshot AS student,a.participant_number_snapshot AS number,a.class_name_snapshot AS class_name
       FROM people p JOIN exam_attempts a ON a.id=p.latest_id
       ORDER BY lower(a.student_name_snapshot),a.participant_number_snapshot,p.participant_identity_id
       LIMIT $2::integer OFFSET $3::integer
     )
     SELECT p.participant_identity_id::text AS "identityId",p.student,p.number,p.class_name AS "className",e.finished,e.unfinished,e.evidence,
       COALESCE(f.revision,0)::text AS revision,(f.finalized_at IS NOT NULL) AS finalized,
       (SELECT count(*)::int FROM exam_retake_permissions rp JOIN exam_schedule_runs r ON r.id=rp.run_id
         WHERE r.exam_test_id=$1::bigint AND rp.participant_identity_id=p.participant_identity_id
           AND rp.consumed_at IS NULL AND rp.revoked_at IS NULL) AS "pendingPermissions"
     FROM paged p
     CROSS JOIN LATERAL (
       SELECT count(*) FILTER (WHERE a.completed_at IS NOT NULL)::int AS finished,
         count(*) FILTER (WHERE a.completed_at IS NULL)::int AS unfinished,
         COALESCE(json_agg(json_build_object('id',a.id::text,'kind',a.kind,'correctCount',a.correct_count,'questionCount',a.question_count) ORDER BY a.id)
           FILTER (WHERE a.completed_at IS NOT NULL),'[]'::json) AS evidence
       FROM exam_attempts a WHERE a.exam_test_id=$1::bigint AND a.participant_identity_id=p.participant_identity_id
     ) e
     LEFT JOIN exam_final_grade_state f ON f.exam_test_id=$1::bigint AND f.participant_identity_id=p.participant_identity_id
     ORDER BY lower(p.student),p.number,p.participant_identity_id`, [testId, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  )).rows;
  const audit = (await client.query<AuditRow>(
    `SELECT o.action,o.old_value AS "oldValue",o.new_value AS "newValue",u.username AS actor,
       to_char(o.created_at AT TIME ZONE 'Asia/Jakarta','DD/MM/YYYY HH24:MI:SS') || ' WIB' AS time,
       st.name AS student,i.participant_number AS number,o.recorded_method AS "recordedMethod",
       o.recorded_hundredths AS "recordedHundredths",o.recorded_attempt_count AS "recordedAttemptCount",o.revoked_permissions AS revoked
     FROM exam_final_grade_operations o LEFT JOIN admin_users u ON u.id=o.actor_id
     LEFT JOIN participant_identities i ON i.id=o.participant_identity_id LEFT JOIN school_students st ON st.id=i.student_id
     WHERE o.exam_test_id=$1::bigint AND o.result='applied'
     ORDER BY o.created_at DESC,o.operation_id DESC LIMIT 20`, [testId],
  )).rows;
  return { method: setting.method, methodRevision: setting.revision, total, page, pages, audit, rows: rows.map((row) => {
    const value = calculateFinalGrade(setting.method, row.evidence);
    const kinds = (['regular', 'makeup', 'remedial'] as Kind[]).filter((kind) => row.evidence.some((item) => item.kind === kind));
    return { identityId: row.identityId, student: row.student, number: row.number, className: row.className,
      finished: row.finished, unfinished: row.unfinished, pendingPermissions: row.pendingPermissions, finalized: row.finalized,
      revision: row.revision, score: value === null ? null : formatFinalGrade(value), digest: finalGradeEvidenceDigest(row.evidence),
      kinds, hiddenKinds: kinds.filter((kind) => !visibility.some((item) => item.kind === kind && item.visible)) };
  }) };
}
