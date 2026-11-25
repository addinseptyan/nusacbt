import "server-only";

import { getPostgresPool } from "@/lib/postgres";

export type DashboardScheduleItem = {
  runId: string;
  examTestId: string;
  testName: string;
  runLabel: string;
  kind: "regular" | "makeup" | "remedial";
  timeZone: "WIB" | "WITA" | "WIT";
  startLocal: string;
  endLocal: string;
  durationMinutes: number;
  participantCount: number;
  live: boolean;
};

export type DashboardSummary = {
  totalStudents: number;
  activeYearStudents: number;
  activeYearName: string | null;
  totalYears: number;
  totalPeriods: number;
  unmappedPeriods: number;
  loginPeriodName: string | null;
  activeLoginPeriodCount: number;
  activeLoginAccounts: number;
  activeParticipantSessions: number;
  totalQuestions: number;
  totalTopics: number;
  questionsWithImages: number;
  totalTests: number;
  publishedRuns: number;
  liveRuns: number;
  activeTokens: number;
  totalAttempts: number;
  completedAttempts: number;
  activeAttempts: number;
  waitingAttempts: number;
  finalizedGrades: number;
  schedules: DashboardScheduleItem[];
};

export async function loadDashboardSummary(): Promise<DashboardSummary> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ");

    const stats = (
      await client.query<{
        totalStudents: number;
        activeYearStudents: number;
        activeYearName: string | null;
        totalYears: number;
        totalPeriods: number;
        unmappedPeriods: number;
        loginPeriodName: string | null;
        activeLoginPeriodCount: number;
        activeLoginAccounts: number;
        activeParticipantSessions: number;
        totalQuestions: number;
        totalTopics: number;
        questionsWithImages: number;
        totalTests: number;
        publishedRuns: number;
        liveRuns: number;
        activeTokens: number;
        totalAttempts: number;
        completedAttempts: number;
        activeAttempts: number;
        waitingAttempts: number;
        finalizedGrades: number;
      }>(`
        WITH active_year AS (
          SELECT y.id, y.name
          FROM academic_year_settings s
          LEFT JOIN academic_years y ON y.id = s.active_year_id
          WHERE s.id = 1
        ),
        login_periods AS (
          SELECT ep.id, ep.name, ep.start_date
          FROM exam_periods ep
          JOIN active_year ay ON ay.id = ep.academic_year_id
          WHERE ep.is_active = true
        )
        SELECT
          (SELECT count(*)::int FROM school_students) AS "totalStudents",
          (SELECT count(*)::int FROM academic_year_enrollments e JOIN active_year ay ON ay.id = e.academic_year_id WHERE e.status = 'active') AS "activeYearStudents",
          (SELECT name FROM active_year) AS "activeYearName",
          (SELECT count(*)::int FROM academic_years) AS "totalYears",
          (SELECT count(*)::int FROM exam_periods) AS "totalPeriods",
          (SELECT count(*)::int FROM exam_periods WHERE academic_year_id IS NULL) AS "unmappedPeriods",
          (SELECT string_agg(name, ', ' ORDER BY start_date DESC, id DESC) FROM login_periods) AS "loginPeriodName",
          (SELECT count(*)::int FROM login_periods) AS "activeLoginPeriodCount",
          (SELECT count(*)::int
             FROM participant_identities i
             JOIN student_class_placements p ON p.student_id = i.student_id AND p.period_id = i.period_id AND p.ended_at IS NULL
             JOIN login_periods lp ON lp.id = i.period_id) AS "activeLoginAccounts",
          (SELECT count(*)::int FROM participant_sessions WHERE expires_at > clock_timestamp()) AS "activeParticipantSessions",
          (SELECT count(*)::int FROM question_bank) AS "totalQuestions",
          (SELECT count(*)::int FROM question_topics) AS "totalTopics",
          (SELECT count(*)::int
             FROM question_bank
             WHERE prompt_image IS NOT NULL OR option_a_image IS NOT NULL OR option_b_image IS NOT NULL
                OR option_c_image IS NOT NULL OR option_d_image IS NOT NULL OR option_e_image IS NOT NULL) AS "questionsWithImages",
          (SELECT count(*)::int FROM exam_tests) AS "totalTests",
          (SELECT count(*)::int FROM exam_schedule_runs WHERE published_at IS NOT NULL) AS "publishedRuns",
          (SELECT count(*)::int
             FROM exam_schedule_runs
             WHERE published_at IS NOT NULL
               AND clock_timestamp() >= starts_at
               AND clock_timestamp() < starts_at + make_interval(mins => duration_minutes)) AS "liveRuns",
          (SELECT count(*)::int
             FROM exam_access_tokens
             WHERE revoked_at IS NULL AND expires_at > clock_timestamp()) AS "activeTokens",
          (SELECT count(*)::int FROM exam_attempts) AS "totalAttempts",
          (SELECT count(*)::int FROM exam_attempts WHERE completed_at IS NOT NULL) AS "completedAttempts",
          (SELECT count(*)::int FROM exam_attempts WHERE completed_at IS NULL AND deadline > clock_timestamp()) AS "activeAttempts",
          (SELECT count(*)::int FROM exam_attempts WHERE completed_at IS NULL AND deadline <= clock_timestamp()) AS "waitingAttempts",
          (SELECT count(*)::int FROM exam_final_grade_state WHERE finalized_at IS NOT NULL) AS "finalizedGrades"
      `)
    ).rows[0];

    const schedules = (
      await client.query<DashboardScheduleItem>(`
        SELECT
          r.id::text AS "runId",
          r.exam_test_id::text AS "examTestId",
          t.name AS "testName",
          r.label AS "runLabel",
          r.kind,
          r.time_zone AS "timeZone",
          to_char(
            r.starts_at AT TIME ZONE CASE r.time_zone WHEN 'WITA' THEN 'Asia/Makassar' WHEN 'WIT' THEN 'Asia/Jayapura' ELSE 'Asia/Jakarta' END,
            'DD/MM/YYYY HH24:MI'
          ) AS "startLocal",
          to_char(
            (r.starts_at + make_interval(mins => r.duration_minutes)) AT TIME ZONE CASE r.time_zone WHEN 'WITA' THEN 'Asia/Makassar' WHEN 'WIT' THEN 'Asia/Jayapura' ELSE 'Asia/Jakarta' END,
            'DD/MM/YYYY HH24:MI'
          ) AS "endLocal",
          r.duration_minutes AS "durationMinutes",
          (SELECT count(*)::int FROM exam_schedule_participants sp WHERE sp.run_id = r.id) AS "participantCount",
          (clock_timestamp() >= r.starts_at AND clock_timestamp() < r.starts_at + make_interval(mins => r.duration_minutes)) AS live
        FROM exam_schedule_runs r
        JOIN exam_tests t ON t.id = r.exam_test_id
        WHERE r.published_at IS NOT NULL
          AND r.starts_at + make_interval(mins => r.duration_minutes) > clock_timestamp()
        ORDER BY live DESC, r.starts_at ASC, r.id ASC
        LIMIT 6
      `)
    ).rows;

    await client.query("COMMIT");
    return { ...stats, schedules };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
