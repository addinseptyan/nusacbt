import "server-only";

import { PARTICIPANT_SCHEDULE_DAY_FILTER, PARTICIPANT_SCHEDULE_DAY_JOIN } from "@/lib/participant-schedule-day.mjs";
import { participantSessionHash } from "@/lib/participant-session-lock";
import { getPostgresPool } from "@/lib/postgres";

type Screen = { runId: string | null; name: string | null; label: string | null; status: "active" | "future" | "past" | null;
  startLocal: string | null; endLocal: string | null; zone: string | null; duration: number | null; attemptId: string | null; retakePermissionId: string | null };

/** Satu query: parameter URL tidak boleh memilih identitas atau periode lain. */
export async function loadExamStartScreen(runId: string): Promise<Screen | null> {
  const hash = await participantSessionHash(); if (!hash) return null;
  const result = await getPostgresPool().query<Screen>(
    `WITH auth AS (
       SELECT i.id AS identity_id,i.period_id,i.student_id
       FROM participant_sessions sess JOIN participant_identities i ON i.id=sess.participant_identity_id
       JOIN participant_login_settings ls ON ls.id=1 AND ls.period_id=i.period_id
       JOIN student_class_placements pl ON pl.id=sess.placement_id AND pl.student_id=i.student_id AND pl.period_id=i.period_id AND pl.ended_at IS NULL
       JOIN participant_passwords pw ON pw.participant_identity_id=i.id
       WHERE sess.token_hash=$1 AND sess.expires_at>clock_timestamp()
         AND i.username=sess.username_snapshot AND i.updated_at=sess.identity_revision
         AND pw.updated_at=sess.password_revision AND sha256(convert_to(pw.password_hash,'UTF8'))=sess.password_hash_digest
     )
     SELECT schedule.id::text AS "runId",schedule.name,schedule.label,schedule.status,schedule."startLocal",schedule."endLocal",
       schedule.zone,schedule.duration,schedule.attempt_id::text AS "attemptId",schedule.retake_id::text AS "retakePermissionId"
     FROM auth a LEFT JOIN LATERAL (
       SELECT r.id,t.name,r.label,r.time_zone AS zone,r.duration_minutes AS duration,att.id AS attempt_id,
         CASE WHEN att.completed_at IS NOT NULL AND att.deadline>clock_timestamp()
           AND r.starts_at<=clock_timestamp() AND r.starts_at+r.duration_minutes*interval '1 minute'>clock_timestamp()
           THEN retry.id ELSE NULL END AS retake_id,
         CASE WHEN r.starts_at>clock_timestamp() THEN 'future'
           WHEN r.starts_at+r.duration_minutes*interval '1 minute'>clock_timestamp() THEN 'active' ELSE 'past' END AS status,
         to_char(r.starts_at AT TIME ZONE (CASE r.time_zone WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END),'DD/MM/YYYY HH24:MI') AS "startLocal",
         to_char((r.starts_at+r.duration_minutes*interval '1 minute') AT TIME ZONE (CASE r.time_zone WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END),'DD/MM/YYYY HH24:MI') AS "endLocal"
       FROM exam_schedule_runs r JOIN exam_schedule_participants p ON p.run_id=r.id AND p.student_id=a.student_id
       JOIN exam_tests t ON t.id=r.exam_test_id
       LEFT JOIN LATERAL (
         SELECT id,completed_at,deadline FROM exam_attempts WHERE run_id=r.id AND participant_identity_id=a.identity_id
         ORDER BY id DESC LIMIT 1
       ) att ON true
       LEFT JOIN LATERAL (
         SELECT id FROM exam_retake_permissions WHERE previous_attempt_id=att.id AND run_id=r.id
           AND participant_identity_id=a.identity_id AND revoked_at IS NULL AND consumed_at IS NULL LIMIT 1
       ) retry ON true
       ${PARTICIPANT_SCHEDULE_DAY_JOIN}
       WHERE r.id=$2::bigint AND r.period_id=a.period_id AND r.published_at IS NOT NULL AND ${PARTICIPANT_SCHEDULE_DAY_FILTER}
     ) schedule ON true`, [hash, runId],
  );
  return result.rows[0] ?? null;
}
