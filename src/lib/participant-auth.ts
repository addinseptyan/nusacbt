import "server-only";

import { randomBytes, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import type { PoolClient } from "pg";

import { gradeExamCounts } from "@/lib/exam-grading.mjs";
import { calculateFinalGrade, formatFinalGrade, type FinalGradeMethod } from "@/lib/exam-final-grade.mjs";
import { participantAttemptBucket, participantSessionDigest } from "@/lib/participant-login-validation.mjs";
import { PARTICIPANT_SCHEDULE_DAY_FILTER, PARTICIPANT_SCHEDULE_DAY_JOIN } from "@/lib/participant-schedule-day.mjs";
import { verifyPassword } from "@/lib/password.mjs";
import { getPostgresPool } from "@/lib/postgres";

const COOKIE_NAME = "nusacbt_participant_session";
const COOKIE_PATH = "/peserta";
const SESSION_SECONDS = 8 * 60 * 60;
const PAGE_SIZE = 20;
const HASH_FORMAT = /^scrypt\$32768\$8\$3\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/;
// Dummy publik memastikan akun/identitas tanpa sandi juga melalui scrypt.
const DUMMY_HASH = "scrypt$32768$8$3$bnVzYWNidC1kdW1teS12MQ$Raa-ekVKy8Za16jY9UvGVQe7QgcE8qumcVaR-QYwcSlPWOICqa72jz34cvRzGMbcqD08s2eMvJpOmu-lx5iNfA";

type Credentials = { username: string; password: string; periodId?: string | null };
type ScopedCredentials = { username: string; password: string; periodId: string };
type IdentityLookup = { id: string; studentId: string };
type LockedIdentity = { id: string; username: string };
type PasswordRow = { passwordHash: string };
type AttemptRow = { failedAttempts: number; locked: boolean; lockExpired: boolean };

export type ActiveLoginPeriod = { id: string; name: string };
export type ParticipantSchedule = {
  id: string; name: string; label: string; kind: "regular" | "makeup" | "remedial"; sessionNumber: number | null;
  startLocal: string; endLocal: string; zone: "WIB" | "WITA" | "WIT";
  durationMinutes: number; status: "Belum dimulai" | "Berlangsung" | "Berakhir";
  attemptId: string | null; attemptCompleted: boolean; retakePermissionId: string | null; finalized: boolean; finalRevision: string;
};
export type ParticipantView = {
  studentName: string; username: string; participantNumber: string; className: string; periodName: string;
  total: number; page: number; pages: number; tests: ParticipantSchedule[];
};

export function participantCookieSecure() {
  const setting = process.env.NUSACBT_COOKIE_SECURE;
  if (!setting) return process.env.NODE_ENV === "production";
  if (setting === "true") return true;
  if (setting === "false") return false;
  throw new Error("NUSACBT_COOKIE_SECURE harus true atau false.");
}

async function globalAttemptSlot() {
  // Satu UPDATE atomik berlaku di semua proses aplikasi yang memakai database
  // ini. 180 permintaan per menit bersifat global, bukan batas per IP.
  const result = await getPostgresPool().query<{ allowed: boolean }>(
    `WITH moment AS (SELECT clock_timestamp() AS current_time)
     UPDATE participant_login_global_limit AS l
     SET window_started_at = CASE WHEN l.window_started_at <= moment.current_time - interval '1 minute'
       OR l.window_started_at > moment.current_time THEN moment.current_time ELSE l.window_started_at END,
       attempts = CASE WHEN l.window_started_at <= moment.current_time - interval '1 minute'
       OR l.window_started_at > moment.current_time THEN 1 ELSE LEAST(l.attempts + 1, 181) END
     FROM moment WHERE l.id = 1 RETURNING l.attempts <= 180 AS allowed`,
  );
  if (result.rowCount !== 1) throw new Error("Pembatas login peserta tidak tersedia.");
  return result.rows[0].allowed;
}

async function pruneOldAuthRows() {
  const pool = getPostgresPool();
  await pool.query(
    `DELETE FROM participant_login_attempts WHERE bucket_hash IN (
       SELECT bucket_hash FROM participant_login_attempts
       WHERE last_attempt_at < clock_timestamp() - interval '24 hours'
         AND (locked_until IS NULL OR locked_until < clock_timestamp())
       ORDER BY last_attempt_at LIMIT 2000 FOR UPDATE SKIP LOCKED
     )`,
  );
  await pool.query(
    `DELETE FROM participant_sessions WHERE token_hash IN (
       SELECT token_hash FROM participant_sessions WHERE expires_at <= clock_timestamp()
       ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED
     )`,
  );
}

async function lockIdentityRows(client: PoolClient, credentials: ScopedCredentials) {
  const lookup = await client.query<IdentityLookup>(
    `SELECT id::text AS id, student_id::text AS "studentId"
     FROM participant_identities WHERE period_id = $1::bigint AND lower(username COLLATE "C") = $2`,
    [credentials.periodId, credentials.username],
  );
  if (!lookup.rows[0]) return null;
  const candidate = lookup.rows[0];
  const student = await client.query("SELECT id FROM school_students WHERE id = $1::bigint FOR SHARE", [candidate.studentId]);
  const period = await client.query(
    `SELECT e.id FROM exam_periods e JOIN academic_year_settings ys ON ys.id = 1 AND ys.active_year_id = e.academic_year_id
     WHERE e.id = $1::bigint AND e.is_active = true FOR SHARE OF e`,
    [credentials.periodId],
  );
  const placement = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM student_class_placements
     WHERE student_id = $1::bigint AND period_id = $2::bigint AND ended_at IS NULL FOR SHARE`,
    [candidate.studentId, credentials.periodId],
  );
  const identity = await client.query<LockedIdentity>(
    `SELECT id::text AS id, username FROM participant_identities
     WHERE id = $1::bigint AND student_id = $2::bigint AND period_id = $3::bigint
       AND lower(username COLLATE "C") = $4 FOR SHARE`,
    [candidate.id, candidate.studentId, credentials.periodId, credentials.username],
  );
  const password = await client.query<PasswordRow>(
    `SELECT password_hash AS "passwordHash" FROM participant_passwords
     WHERE participant_identity_id = $1::bigint FOR SHARE`, [candidate.id],
  );
  return {
    studentExists: student.rowCount === 1, periodExists: period.rowCount === 1,
    placement: placement.rows[0] ?? null, identity: identity.rows[0] ?? null, password: password.rows[0] ?? null,
  };
}

/** Sandi dan token mentah tidak ditulis ke log atau database. */
export async function authenticateParticipant(credentials: Credentials): Promise<string | null> {
  if (!await globalAttemptSlot()) return null;
  if (randomInt(16) === 0) await pruneOldAuthRows().catch(() => {});
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    // Tahan pengaturan sampai sesi diterbitkan. Penggantian/penonaktifan periode
    // menunggu login yang sedang berjalan lalu menghapus sesi terkait secara atomik.
    const setting = await client.query<{ id: number }>(
      "SELECT id FROM participant_login_settings WHERE id = 1 FOR SHARE",
    );
    if (setting.rowCount !== 1) throw new Error("Pengaturan login peserta tidak tersedia.");

    const activePeriods = (
      await client.query<ActiveLoginPeriod>(
        `SELECT e.id::text AS id, e.name
         FROM exam_periods e
         JOIN academic_year_settings ys ON ys.id = 1 AND ys.active_year_id = e.academic_year_id
         WHERE e.is_active = true
         ORDER BY e.start_date DESC, e.id DESC
         FOR SHARE OF e`,
      )
    ).rows;

    if (activePeriods.length === 0) {
      await client.query("COMMIT");
      return null;
    }

    let periodId: string | null = null;
    if (activePeriods.length === 1) {
      if (credentials.periodId && credentials.periodId !== activePeriods[0].id) {
        await client.query("COMMIT");
        return null;
      }
      periodId = activePeriods[0].id;
    } else {
      if (!credentials.periodId || !activePeriods.some((p) => p.id === credentials.periodId)) {
        await client.query("COMMIT");
        return null;
      }
      periodId = credentials.periodId;
    }

    const scoped: ScopedCredentials = { username: credentials.username, password: credentials.password, periodId };
    const bucket = participantAttemptBucket(periodId, credentials.username);
    await client.query("INSERT INTO participant_login_attempts(bucket_hash) VALUES($1) ON CONFLICT (bucket_hash) DO NOTHING", [bucket]);
    const attempt = await client.query<AttemptRow>(
      `SELECT failed_attempts AS "failedAttempts", COALESCE(locked_until > clock_timestamp(), false) AS locked,
         COALESCE(locked_until <= clock_timestamp(), false) AS "lockExpired"
       FROM participant_login_attempts WHERE bucket_hash = $1 FOR UPDATE`, [bucket],
    );
    const state = attempt.rows[0];
    if (!state) throw new Error("Bucket login tidak tersedia.");
    if (state.locked) {
      await client.query("UPDATE participant_login_attempts SET last_attempt_at = clock_timestamp() WHERE bucket_hash = $1", [bucket]);
      await client.query("COMMIT");
      return null;
    }

    const records = await lockIdentityRows(client, scoped);
    const storedHash = records?.password?.passwordHash;
    const hashValid = typeof storedHash === "string" && HASH_FORMAT.test(storedHash);
    const matches = await verifyPassword(credentials.password, hashValid ? storedHash : DUMMY_HASH);
    if (!matches || !hashValid || !records?.studentExists || !records.periodExists || !records.placement || !records.identity) {
      const failures = (state.lockExpired ? 0 : state.failedAttempts) + 1;
      await client.query(
        `UPDATE participant_login_attempts SET failed_attempts = LEAST($2::integer, 5),
          locked_until = CASE WHEN $2::integer >= 5 THEN clock_timestamp() + interval '15 minutes' ELSE NULL END,
          last_attempt_at = clock_timestamp() WHERE bucket_hash = $1`, [bucket, failures],
      );
      await client.query("COMMIT");
      return null;
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = participantSessionDigest(token);
    if (!tokenHash) throw new Error("Token sesi tidak valid.");
    await client.query("DELETE FROM participant_sessions WHERE participant_identity_id = $1::bigint", [records.identity.id]);
    const inserted = await client.query(
      `INSERT INTO participant_sessions(token_hash, participant_identity_id, placement_id, username_snapshot,
         identity_revision, password_revision, password_hash_digest, expires_at)
       SELECT $1::bytea, i.id, p.id, i.username, i.updated_at, pw.updated_at,
         sha256(convert_to(pw.password_hash, 'UTF8')), clock_timestamp() + interval '8 hours'
       FROM participant_identities i JOIN participant_passwords pw ON pw.participant_identity_id = i.id
       JOIN student_class_placements p ON p.id = $3::bigint AND p.student_id = i.student_id
         AND p.period_id = i.period_id AND p.ended_at IS NULL
       WHERE i.id = $2::bigint AND i.username = $4`,
      [tokenHash, records.identity.id, records.placement.id, records.identity.username],
    );
    if (inserted.rowCount !== 1) throw new Error("Sesi peserta tidak dapat diterbitkan.");
    await client.query(
      `UPDATE participant_login_attempts SET failed_attempts = 0, locked_until = NULL,
       last_attempt_at = clock_timestamp() WHERE bucket_hash = $1`, [bucket],
    );
    await client.query("COMMIT");
    return token;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function setParticipantSessionCookie(token: string, secure: boolean) {
  if (!participantSessionDigest(token)) throw new Error("Token sesi tidak valid.");
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true, secure, sameSite: "strict", path: COOKIE_PATH, maxAge: SESSION_SECONDS,
  });
}

export async function endParticipantSession() {
  const store = await cookies();
  const hash = participantSessionDigest(store.get(COOKIE_NAME)?.value);
  if (hash) await getPostgresPool().query("DELETE FROM participant_sessions WHERE token_hash = $1", [hash]);
  store.set(COOKIE_NAME, "", { httpOnly: true, secure: participantCookieSecure(), sameSite: "strict", path: COOKIE_PATH, maxAge: 0 });
}

export async function activeParticipantLoginPeriods(): Promise<ActiveLoginPeriod[]> {
  const check = await getPostgresPool().query("SELECT 1 FROM participant_login_settings WHERE id = 1");
  if (check.rowCount !== 1) throw new Error("Pengaturan login peserta tidak tersedia.");
  const result = await getPostgresPool().query<ActiveLoginPeriod>(
    `SELECT e.id::text AS id, e.name
     FROM exam_periods e
     JOIN academic_year_settings ys ON ys.id = 1 AND ys.active_year_id = e.academic_year_id
     WHERE e.is_active = true
     ORDER BY e.start_date DESC, e.id DESC`,
  );
  return result.rows;
}

export async function participantLoginEnabled(): Promise<boolean> {
  return (await activeParticipantLoginPeriods()).length > 0;
}

export async function participantView(requestedPage: number): Promise<ParticipantView | null> {
  const hash = participantSessionDigest((await cookies()).get(COOKIE_NAME)?.value);
  if (!hash) return null;
  const result = await getPostgresPool().query<ParticipantView>(
    `WITH auth AS (
       SELECT i.id AS identity_id, i.period_id, st.id AS student_id, st.name AS "studentName", i.username, i.participant_number AS "participantNumber",
         c.level || ' ' || m.name AS "className", ep.name AS "periodName"
       FROM participant_sessions sess
       JOIN participant_identities i ON i.id = sess.participant_identity_id
       JOIN school_students st ON st.id = i.student_id
       JOIN participant_login_settings ls ON ls.id = 1
       JOIN exam_periods ep ON ep.id = i.period_id
       JOIN academic_year_settings ys ON ys.id = 1 AND ys.active_year_id = ep.academic_year_id
       JOIN student_class_placements pl ON pl.id = sess.placement_id AND pl.student_id = i.student_id
         AND pl.period_id = i.period_id AND pl.ended_at IS NULL
       JOIN school_classes c ON c.id = pl.class_id JOIN school_majors m ON m.id = c.major_id
       JOIN participant_passwords pw ON pw.participant_identity_id = i.id
       WHERE sess.token_hash = $1 AND sess.expires_at > clock_timestamp()
         AND ep.is_active = true
         AND i.username = sess.username_snapshot AND i.updated_at = sess.identity_revision
         AND pw.updated_at = sess.password_revision AND sha256(convert_to(pw.password_hash, 'UTF8')) = sess.password_hash_digest
     ), visible AS (
       SELECT r.id,r.exam_test_id,r.label,r.kind,r.session_number,r.starts_at,r.time_zone,r.duration_minutes,
         att.id AS attempt_id, (att.completed_at IS NOT NULL) AS attempt_completed,(fg.finalized_at IS NOT NULL) AS finalized,COALESCE(fg.revision,0)::text AS final_revision,
         CASE WHEN fg.finalized_at IS NULL AND att.completed_at IS NOT NULL AND att.deadline>clock_timestamp()
           AND r.starts_at<=clock_timestamp() AND r.starts_at+r.duration_minutes*interval '1 minute'>clock_timestamp()
           THEN retry.id ELSE NULL END AS retake_id
       FROM exam_schedule_runs r JOIN exam_schedule_participants p ON p.run_id=r.id
       JOIN auth a ON a.period_id=r.period_id AND a.student_id=p.student_id
       LEFT JOIN LATERAL (
         SELECT id,completed_at,deadline FROM exam_attempts
         WHERE run_id=r.id AND participant_identity_id=a.identity_id ORDER BY id DESC LIMIT 1
       ) att ON true
       LEFT JOIN LATERAL (
         SELECT id FROM exam_retake_permissions WHERE previous_attempt_id=att.id AND run_id=r.id
           AND participant_identity_id=a.identity_id AND revoked_at IS NULL AND consumed_at IS NULL LIMIT 1
       ) retry ON true
       LEFT JOIN exam_final_grade_state fg ON fg.exam_test_id=r.exam_test_id AND fg.participant_identity_id=a.identity_id
       ${PARTICIPANT_SCHEDULE_DAY_JOIN}
       WHERE r.published_at IS NOT NULL AND ${PARTICIPANT_SCHEDULE_DAY_FILTER}
     ), counts AS (
       SELECT count(*)::int AS total FROM visible
     ), page_info AS (
       SELECT total, GREATEST(1, CEIL(total::numeric / $3::integer)::int) AS pages,
         LEAST($2::integer, GREATEST(1, CEIL(total::numeric / $3::integer)::int)) AS page FROM counts
     )
     SELECT a."studentName", a.username, a."participantNumber", a."className", a."periodName",
       pi.total, pi.page, pi.pages,
       COALESCE((SELECT json_agg(d) FROM (
         SELECT v.id::text AS id, e.name, v.label, v.kind, v.session_number AS "sessionNumber",
           v.attempt_id::text AS "attemptId", v.attempt_completed AS "attemptCompleted", v.retake_id::text AS "retakePermissionId", v.finalized,v.final_revision AS "finalRevision",
           to_char(v.starts_at AT TIME ZONE (CASE v.time_zone WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END), 'DD/MM/YYYY HH24:MI') AS "startLocal",
           to_char((v.starts_at + v.duration_minutes * interval '1 minute') AT TIME ZONE (CASE v.time_zone WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END), 'DD/MM/YYYY HH24:MI') AS "endLocal",
           v.time_zone AS zone, v.duration_minutes AS "durationMinutes",
           CASE WHEN v.starts_at > statement_timestamp() THEN 'Belum dimulai'
             WHEN v.starts_at + v.duration_minutes * interval '1 minute' > statement_timestamp() THEN 'Berlangsung'
             ELSE 'Berakhir' END AS status
         FROM visible v JOIN exam_tests e ON e.id=v.exam_test_id
         ORDER BY CASE WHEN v.starts_at <= statement_timestamp() AND v.starts_at + v.duration_minutes * interval '1 minute' > statement_timestamp() THEN 0
             WHEN v.starts_at > statement_timestamp() THEN 1 ELSE 2 END,
           CASE WHEN v.starts_at + v.duration_minutes * interval '1 minute' > statement_timestamp() THEN v.starts_at END ASC,
           CASE WHEN v.starts_at + v.duration_minutes * interval '1 minute' <= statement_timestamp() THEN v.starts_at END DESC, v.id DESC
         LIMIT $3::integer OFFSET ((pi.page - 1) * $3::integer)
       ) d), '[]'::json) AS tests
     FROM auth a CROSS JOIN page_info pi`,
    [hash, requestedPage, PAGE_SIZE],
  );
  return result.rows[0] ?? null;
}

export type ParticipantSharedScores = {
  total: number; page: number; pages: number;
  scores: ({ id: string; testName: string; score: string } & (
    | { type: "attempt"; runLabel: string; kind: "regular" | "makeup" | "remedial"; attemptNumber: number }
    | { type: "final"; method: FinalGradeMethod }
  ))[];
};

export async function participantSharedScores(requestedPage: number): Promise<ParticipantSharedScores | null> {
  const hash = participantSessionDigest((await cookies()).get(COOKIE_NAME)?.value);
  if (!hash) return null;
  type RawItem = { id: string; type: "attempt" | "final"; testName: string; runLabel: string | null;
    kind: "regular" | "makeup" | "remedial" | null; attemptNumber: number | null;
    correct: number | null; questionCount: number | null; method: FinalGradeMethod | null;
    evidence: { correctCount: number; questionCount: number }[] | null };
  type Raw = { total: number; page: number; pages: number; scores: RawItem[] };
  const result = await getPostgresPool().query<Raw>(
    `WITH auth AS (
       SELECT i.id AS identity_id, i.period_id
       FROM participant_sessions sess JOIN participant_identities i ON i.id=sess.participant_identity_id
       JOIN participant_login_settings ls ON ls.id=1
       JOIN exam_periods ep ON ep.id=i.period_id
       JOIN academic_year_settings ys ON ys.id=1 AND ys.active_year_id=ep.academic_year_id
       JOIN student_class_placements pl ON pl.id=sess.placement_id AND pl.student_id=i.student_id
         AND pl.period_id=i.period_id AND pl.ended_at IS NULL
       JOIN participant_passwords pw ON pw.participant_identity_id=i.id
       WHERE sess.token_hash=$1 AND sess.expires_at>clock_timestamp()
         AND ep.is_active=true
         AND i.username=sess.username_snapshot AND i.updated_at=sess.identity_revision
         AND pw.updated_at=sess.password_revision AND sha256(convert_to(pw.password_hash,'UTF8'))=sess.password_hash_digest
     ), visible AS (
       SELECT 'attempt:' || a.id::text AS id,'attempt'::text AS type,a.test_name_snapshot AS test_name,
         a.run_label_snapshot AS run_label,a.kind,
         (SELECT count(*)::int FROM exam_attempts h WHERE h.run_id=a.run_id
           AND h.participant_identity_id=a.participant_identity_id AND h.id<=a.id) AS attempt_number,
         a.correct_count AS correct,a.question_count,NULL::text AS method,NULL::json AS evidence,a.completed_at AS event_at
       FROM exam_attempts a JOIN auth ON auth.identity_id=a.participant_identity_id AND auth.period_id=a.period_id
       JOIN exam_score_category_visibility v ON v.kind=a.kind AND v.visible_to_participants
       WHERE a.completed_at IS NOT NULL
       UNION ALL
       SELECT 'final:' || f.exam_test_id::text,'final'::text,t.name,NULL::text,NULL::text,NULL::integer,
         NULL::integer,NULL::integer,COALESCE(s.method,'highest'),
         json_agg(json_build_object('correctCount',a.correct_count,'questionCount',a.question_count) ORDER BY a.id),f.finalized_at
       FROM exam_final_grade_state f JOIN auth ON auth.identity_id=f.participant_identity_id AND auth.period_id=f.period_id
       JOIN exam_tests t ON t.id=f.exam_test_id
       JOIN exam_attempts a ON a.exam_test_id=f.exam_test_id AND a.participant_identity_id=f.participant_identity_id AND a.completed_at IS NOT NULL
       LEFT JOIN exam_score_category_visibility v ON v.kind=a.kind
       LEFT JOIN exam_final_grade_settings s ON s.exam_test_id=f.exam_test_id
       WHERE f.finalized_at IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM exam_attempts active WHERE active.exam_test_id=f.exam_test_id
           AND active.participant_identity_id=f.participant_identity_id AND active.completed_at IS NULL
       )
       GROUP BY f.exam_test_id,f.participant_identity_id,f.finalized_at,t.name,s.method
       HAVING bool_and(COALESCE(v.visible_to_participants,false))
     ), counts AS (SELECT count(*)::int AS total FROM visible),
     page_info AS (
       SELECT total,GREATEST(1,CEIL(total::numeric/$3::integer)::int) AS pages,
         LEAST($2::integer,GREATEST(1,CEIL(total::numeric/$3::integer)::int)) AS page FROM counts
     )
     SELECT pi.total,pi.page,pi.pages,COALESCE((SELECT json_agg(d) FROM (
       SELECT v.id,v.type,v.test_name AS "testName",v.run_label AS "runLabel",v.kind,
         v.correct,v.question_count AS "questionCount",v.attempt_number AS "attemptNumber",v.method,v.evidence
       FROM visible v ORDER BY v.event_at DESC,v.id DESC LIMIT $3::integer OFFSET ((pi.page-1)*$3::integer)
     ) d),'[]'::json) AS scores
     FROM auth CROSS JOIN page_info pi`, [hash, requestedPage, PAGE_SIZE],
  );
  const row = result.rows[0]; if (!row) return null;
  const scores: ParticipantSharedScores["scores"] = row.scores.map((item) => {
    if (item.type === "attempt") {
      const grade = gradeExamCounts(item.correct, item.questionCount);
      if (!grade.ok || !item.kind || item.attemptNumber === null || item.runLabel === null) throw new Error("Data nilai pengerjaan tidak konsisten.");
      return { id: item.id, type: "attempt", testName: item.testName, runLabel: item.runLabel, kind: item.kind, attemptNumber: item.attemptNumber, score: grade.display };
    }
    if (!item.method || !item.evidence) throw new Error("Data nilai akhir tidak konsisten.");
    const score = calculateFinalGrade(item.method, item.evidence);
    if (score === null) throw new Error("Data nilai akhir tidak konsisten.");
    return { id: item.id, type: "final", testName: item.testName, method: item.method, score: formatFinalGrade(score) };
  });
  return { total: row.total, page: row.page, pages: row.pages, scores };
}
