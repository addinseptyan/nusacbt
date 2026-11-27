import { CircleAlert, ClipboardList } from "lucide-react";
import type { PoolClient } from "pg";

import type { TimelineClock, TimelineItem } from "@/app/data-tes/daftar/exam-timeline";
import { ExamTestManager } from "@/app/data-tes/daftar/exam-test-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdminAccess } from "@/lib/admin-auth";
import { APP_TIME_ZONE_IANA, loadDefaultTimeZoneWithClient } from "@/lib/app-settings-service";
import type { ExamPeriodOption, ExamTest, ExamTimeZone } from "@/lib/exam-test-types";
import { getPostgresPool } from "@/lib/postgres";
import type { Question, QuestionLetter, QuestionTopicOption } from "@/lib/question-types";

export const metadata = { title: "Daftar Tes — NusaCBT" };
export const dynamic = "force-dynamic";

type QuestionRow = {
  id: string; revision: string; topicId: string; topicName: string; topicTags: string[]; prompt: string; promptRich: unknown | null; hasPromptImage: boolean;
  a: string; b: string; c: string; d: string; e: string;
  richA: unknown | null; richB: unknown | null; richC: unknown | null; richD: unknown | null; richE: unknown | null;
  hasA: boolean; hasB: boolean; hasC: boolean; hasD: boolean; hasE: boolean; correctOption: QuestionLetter;
};

export default async function ExamTestsPage() {
  const { allowed } = await requireAdminAccess("exams.manage");
  if (!allowed) return <AccessDenied section="Data tes" title="Daftar Tes" />;
  let periods: ExamPeriodOption[]; let tests: ExamTest[]; let topics: QuestionTopicOption[]; let questions: Question[]; let timeline: TimelineItem[]; let clock: TimelineClock;
  let defaultTimeZone: ExamTimeZone = "WIB";
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    defaultTimeZone = await loadDefaultTimeZoneWithClient(client);
    const ianaZone = APP_TIME_ZONE_IANA[defaultTimeZone];
    const periodResult = await client.query<ExamPeriodOption>(
      `SELECT id::text AS id, name, to_char(start_date,'YYYY-MM-DD') AS "startDate",
         CASE WHEN end_date IS NULL THEN NULL ELSE to_char(end_date,'YYYY-MM-DD') END AS "endDate",
         is_active AS "isActive"
       FROM exam_periods ORDER BY is_active DESC, start_date DESC, id DESC`,
    );
    const testResult = await client.query<ExamTest>(
      `SELECT e.id::text AS id, e.xmin::text AS revision, e.name,
         COALESCE(e.tags, ARRAY[]::text[]) AS tags,
         e.period_id::text AS "periodId", p.name AS "periodName",
         to_char(p.start_date, 'YYYY-MM-DD') AS "periodStartDate",
         CASE WHEN p.end_date IS NULL THEN NULL ELSE to_char(p.end_date, 'YYYY-MM-DD') END AS "periodEndDate",
         to_char(e.starts_at AT TIME ZONE $1, 'YYYY-MM-DD"T"HH24:MI') AS "startLocal",
         to_char((e.starts_at + e.duration_minutes * interval '1 minute') AT TIME ZONE $1, 'YYYY-MM-DD"T"HH24:MI') AS "endLocal",
         $2::text AS "timeZone", e.duration_minutes AS "durationMinutes", e.shuffle_questions AS "shuffleQuestions", e.shuffle_options AS "shuffleOptions",
         COALESCE((SELECT array_agg(eq.question_id::text ORDER BY eq.position) FROM exam_test_questions eq WHERE eq.exam_test_id=e.id), ARRAY[]::text[]) AS "questionIds",
         json_build_object(
           'regular', json_build_object(
             'draft', COALESCE(rs."regularDraft", 0),
             'published', COALESCE(rs."regularPublished", 0)
           ),
           'makeup', json_build_object(
             'draft', COALESCE(rs."makeupDraft", 0),
             'published', COALESCE(rs."makeupPublished", 0)
           ),
           'remedial', json_build_object(
             'draft', COALESCE(rs."remedialDraft", 0),
             'published', COALESCE(rs."remedialPublished", 0)
           )
         ) AS "runSummary"
       FROM exam_tests e
       JOIN exam_periods p ON p.id=e.period_id
       LEFT JOIN (
         SELECT exam_test_id,
           count(*) FILTER (WHERE kind = 'regular' AND published_at IS NULL)::int AS "regularDraft",
           count(*) FILTER (WHERE kind = 'regular' AND published_at IS NOT NULL)::int AS "regularPublished",
           count(*) FILTER (WHERE kind = 'makeup' AND published_at IS NULL)::int AS "makeupDraft",
           count(*) FILTER (WHERE kind = 'makeup' AND published_at IS NOT NULL)::int AS "makeupPublished",
           count(*) FILTER (WHERE kind = 'remedial' AND published_at IS NULL)::int AS "remedialDraft",
           count(*) FILTER (WHERE kind = 'remedial' AND published_at IS NOT NULL)::int AS "remedialPublished"
         FROM exam_schedule_runs
         GROUP BY exam_test_id
       ) rs ON rs.exam_test_id = e.id
       ORDER BY e.starts_at DESC, e.id DESC`,
      [ianaZone, defaultTimeZone],
    );
    const timelineResult = await client.query<TimelineItem>(
      `SELECT t.id::text AS "testId",r.id::text AS "runId",t.name AS "testName",p.name AS "periodName",
         r.kind,r.label,(r.published_at IS NOT NULL) AS published,
         to_char(r.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startUtc",
         r.time_zone AS "timeZone",r.duration_minutes AS "durationMinutes"
       FROM exam_schedule_runs r JOIN exam_tests t ON t.id=r.exam_test_id JOIN exam_periods p ON p.id=t.period_id
       UNION ALL
       SELECT t.id::text,NULL::text,t.name,p.name,NULL::text,NULL::text,false,
         to_char(t.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),t.time_zone,t.duration_minutes
       FROM exam_tests t JOIN exam_periods p ON p.id=t.period_id
       WHERE NOT EXISTS (SELECT 1 FROM exam_schedule_runs r WHERE r.exam_test_id=t.id)`,
    );
    const clockResult = await client.query<TimelineClock>(
      `SELECT to_char(statement_timestamp() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS "WIB",
         to_char(statement_timestamp() AT TIME ZONE 'Asia/Makassar','YYYY-MM-DD') AS "WITA",
         to_char(statement_timestamp() AT TIME ZONE 'Asia/Jayapura','YYYY-MM-DD') AS "WIT",
         to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`,
    );
    const topicResult = await client.query<QuestionTopicOption>(
      "SELECT id::text AS id, name, COALESCE(tags, ARRAY[]::text[]) AS tags FROM question_topics ORDER BY lower(name), tags_signature, name, id",
    );
    const questionResult = await client.query<QuestionRow>(
      `SELECT q.id::text AS id, q.xmin::text AS revision, q.topic_id::text AS "topicId", t.name AS "topicName",
         COALESCE(t.tags, ARRAY[]::text[]) AS "topicTags",
         q.prompt_text AS prompt, q.prompt_rich AS "promptRich", q.prompt_image IS NOT NULL AS "hasPromptImage",
         q.option_a_text AS a, q.option_b_text AS b, q.option_c_text AS c, q.option_d_text AS d, q.option_e_text AS e,
         q.option_a_rich AS "richA", q.option_b_rich AS "richB", q.option_c_rich AS "richC", q.option_d_rich AS "richD", q.option_e_rich AS "richE",
         q.option_a_image IS NOT NULL AS "hasA", q.option_b_image IS NOT NULL AS "hasB", q.option_c_image IS NOT NULL AS "hasC",
         q.option_d_image IS NOT NULL AS "hasD", q.option_e_image IS NOT NULL AS "hasE", q.correct_option AS "correctOption"
       FROM question_bank q JOIN question_topics t ON t.id=q.topic_id ORDER BY q.id`,
    );
    await client.query("COMMIT");
    periods = periodResult.rows; tests = testResult.rows; topics = topicResult.rows; timeline = timelineResult.rows; clock = clockResult.rows[0];
    questions = questionResult.rows.map((row) => ({
      id: row.id, revision: row.revision, topicId: row.topicId, topicName: row.topicName, topicTags: row.topicTags ?? [], prompt: row.prompt, promptRich: row.promptRich,
      hasPromptImage: row.hasPromptImage, correctOption: row.correctOption,
      options: [
        { letter: "A", text: row.a, rich: row.richA, hasImage: row.hasA }, { letter: "B", text: row.b, rich: row.richB, hasImage: row.hasB },
        { letter: "C", text: row.c, rich: row.richC, hasImage: row.hasC }, { letter: "D", text: row.d, rich: row.richD, hasImage: row.hasD },
        { letter: "E", text: row.e, rich: row.richE, hasImage: row.hasE },
      ],
    }));
  } catch {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Daftar Tes</h1>
        <Alert variant="destructive" role="alert" className="mt-6 max-w-2xl"><CircleAlert className="size-4" /><AlertTitle>Daftar tes belum dapat dimuat</AlertTitle><AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru telah dijalankan dengan <code>npm run db:migrate</code>.</AlertDescription></Alert>
      </div>
    );
  } finally { client?.release(); }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex items-start gap-3">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><ClipboardList className="size-5" /></span>
        <div className="min-w-0"><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Daftar Tes</h1><p className="mt-2 text-[13px] leading-6 text-muted-foreground">Siapkan rancangan, jadwal, soal, dan pengaturan acak untuk setiap tes.</p></div>
      </div>
      <ExamTestManager periods={periods} tests={tests} topics={topics} questions={questions} timeline={timeline} clock={clock} defaultTimeZone={defaultTimeZone} />
    </div>
  );
}
