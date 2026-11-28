import "server-only";

import { displayToken, TOKEN_COLUMNS, TOKEN_JOINS, type TokenRow } from "@/app/data-tes/token/token-data";
import { APP_TIME_ZONE_IANA, loadDefaultTimeZoneWithClient } from "@/lib/app-settings-service";
import type { ExamTimeZone } from "@/lib/exam-test-types";
import { ExamTokenKeyProblem, readConfiguredTokenKey, tokenKeyStatus } from "@/lib/exam-token-key";
import type { AccessTokenRecord, GlobalTokenAutoRotateState, TokenKeyStatus } from "@/lib/exam-token-types";
import { ensureGlobalTokenAutoRotated, readGlobalAutoRotateWithClient } from "@/lib/global-token-scheduler";
import { getPostgresPool } from "@/lib/postgres";

export type DashboardLiveTokenData = {
  tokens: AccessTokenRecord[];
  serverNow: string;
  keyStatus: TokenKeyStatus;
  autoRotate: GlobalTokenAutoRotateState;
};

export type DashboardScheduleItem = {
  runId: string;
  examTestId: string;
  testName: string;
  testTags: string[];
  runLabel: string;
  kind: "regular" | "makeup" | "remedial";
  timeZone: ExamTimeZone;
  startLocal: string;
  endLocal: string;
  durationMinutes: number;
  participantCount: number;
  live: boolean;
};

export type DashboardExamMonitoringRow = {
  runId: string;
  examTestId: string;
  testName: string;
  testTags: string[];
  runLabel: string;
  kind: "regular" | "makeup" | "remedial";
  published: boolean;
  periodName: string;
  startLocal: string;
  endLocal: string;
  totalParticipants: number;
  notStartedCount: number;
  workingCount: number;
  waitingCount: number;
  submittedCount: number;
  timeExpiredCount: number;
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
  defaultTimeZone: ExamTimeZone;
  canViewMonitoring: boolean;
  schedules: DashboardScheduleItem[];
  examMonitoringRows: DashboardExamMonitoringRow[];
};

export async function loadDashboardSummary(options?: { canViewMonitoring?: boolean }): Promise<DashboardSummary> {
  const canViewMonitoring = Boolean(options?.canViewMonitoring);
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ");

    const defaultTimeZone = await loadDefaultTimeZoneWithClient(client);
    const ianaZone = APP_TIME_ZONE_IANA[defaultTimeZone];

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
      await client.query<DashboardScheduleItem>(
        `
        SELECT
          r.id::text AS "runId",
          r.exam_test_id::text AS "examTestId",
          t.name AS "testName",
          COALESCE(t.tags, ARRAY[]::text[]) AS "testTags",
          r.label AS "runLabel",
          r.kind,
          $2::text AS "timeZone",
          to_char(r.starts_at AT TIME ZONE $1, 'DD/MM/YYYY HH24:MI') AS "startLocal",
          to_char((r.starts_at + make_interval(mins => r.duration_minutes)) AT TIME ZONE $1, 'DD/MM/YYYY HH24:MI') AS "endLocal",
          r.duration_minutes AS "durationMinutes",
          (SELECT count(*)::int FROM exam_schedule_participants sp WHERE sp.run_id = r.id) AS "participantCount",
          (clock_timestamp() >= r.starts_at AND clock_timestamp() < r.starts_at + make_interval(mins => r.duration_minutes)) AS live
        FROM exam_schedule_runs r
        JOIN exam_tests t ON t.id = r.exam_test_id
        WHERE r.published_at IS NOT NULL
          AND r.starts_at + make_interval(mins => r.duration_minutes) > clock_timestamp()
        ORDER BY live DESC, r.starts_at ASC, r.id ASC
        LIMIT 6
      `,
        [ianaZone, defaultTimeZone],
      )
    ).rows;

    const examMonitoringRows = canViewMonitoring
      ? (
          await client.query<DashboardExamMonitoringRow>(
            `
            SELECT
              r.id::text AS "runId",
              r.exam_test_id::text AS "examTestId",
              t.name AS "testName",
              COALESCE(t.tags, ARRAY[]::text[]) AS "testTags",
              r.label AS "runLabel",
              r.kind,
              (r.published_at IS NOT NULL) AS published,
              p.name AS "periodName",
              to_char(r.starts_at AT TIME ZONE $1, 'DD/MM/YYYY HH24:MI') AS "startLocal",
              to_char((r.starts_at + make_interval(mins => r.duration_minutes)) AT TIME ZONE $1, 'DD/MM/YYYY HH24:MI') AS "endLocal",
              count(rp.student_id)::int AS "totalParticipants",
              count(*) FILTER (WHERE rp.student_id IS NOT NULL AND a.id IS NULL)::int AS "notStartedCount",
              count(*) FILTER (WHERE a.id IS NOT NULL AND a.completed_at IS NULL AND a.deadline > clock_timestamp())::int AS "workingCount",
              count(*) FILTER (WHERE a.id IS NOT NULL AND a.completed_at IS NULL AND a.deadline <= clock_timestamp())::int AS "waitingCount",
              count(*) FILTER (WHERE a.completed_at IS NOT NULL AND a.completion_reason = 'submitted')::int AS "submittedCount",
              count(*) FILTER (WHERE a.completed_at IS NOT NULL AND a.completion_reason = 'time_expired')::int AS "timeExpiredCount",
              (r.published_at IS NOT NULL AND clock_timestamp() >= r.starts_at AND clock_timestamp() < r.starts_at + make_interval(mins => r.duration_minutes)) AS live
            FROM exam_schedule_runs r
            JOIN exam_tests t ON t.id = r.exam_test_id
            JOIN exam_periods p ON p.id = r.period_id
            LEFT JOIN exam_schedule_participants rp ON rp.run_id = r.id
            LEFT JOIN LATERAL (
              SELECT ea.id, ea.completed_at, ea.completion_reason, ea.deadline
              FROM exam_attempts ea
              WHERE ea.run_id = rp.run_id AND ea.student_id = rp.student_id
              ORDER BY ea.id DESC
              LIMIT 1
            ) a ON rp.student_id IS NOT NULL
            GROUP BY r.id, t.id, p.id
            ORDER BY live DESC, (r.published_at IS NOT NULL) DESC, r.starts_at DESC, r.id DESC
            LIMIT 12
          `,
            [ianaZone],
          )
        ).rows
      : [];

    await client.query("COMMIT");
    return { ...stats, defaultTimeZone, canViewMonitoring, schedules, examMonitoringRows };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function loadDashboardLiveTokens(): Promise<DashboardLiveTokenData> {
  let key: Buffer | undefined;
  let keyStatus: TokenKeyStatus = "missing";
  try {
    key = await readConfiguredTokenKey();
  } catch (error) {
    keyStatus = error instanceof ExamTokenKeyProblem ? error.status : "invalid";
  }

  await ensureGlobalTokenAutoRotated().catch(() => false);
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ");
    if (key) {
      keyStatus = await tokenKeyStatus(client, key);
    }
    const autoRotate = await readGlobalAutoRotateWithClient(client);
    const nowRow = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const now = nowRow.rows[0].now;
    const rows = (
      await client.query<TokenRow>(
        `SELECT ${TOKEN_COLUMNS} ${TOKEN_JOINS}
         WHERE k.revoked_at IS NULL
           AND k.expires_at > clock_timestamp()
         ORDER BY (k.scope = 'global') DESC, k.expires_at ASC, k.id DESC
         LIMIT 20`,
      )
    ).rows;
    await client.query("COMMIT");
    return {
      tokens: rows.map((row) => displayToken(row, key, keyStatus)),
      serverNow: now.toISOString(),
      keyStatus,
      autoRotate,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    key?.fill(0);
    client.release();
  }
}
