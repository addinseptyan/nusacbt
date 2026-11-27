import { CircleAlert, FileOutput } from "lucide-react";

import { ExportWordManager, type ExportQuestionSummary } from "@/app/data-modul/export-soal/export-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdminAccess } from "@/lib/admin-auth";
import { getPostgresPool } from "@/lib/postgres";
import type { QuestionLetter, QuestionTopicOption } from "@/lib/question-types";

export const metadata = { title: "Export Soal Word" };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
function singleParam(val: string | string[] | undefined): string {
  return typeof val === "string" ? val.trim() : Array.isArray(val) && typeof val[0] === "string" ? val[0].trim() : "";
}

export default async function ExportWordPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { allowed } = await requireAdminAccess("questions.export");
  if (!allowed) {
    return <AccessDenied section="Data modul" title="Export Soal Word" />;
  }
  const params = await searchParams;
  const rawTopic = singleParam(params.topik);
  const topicId = /^[1-9]\d{0,18}$/.test(rawTopic) ? rawTopic : "";
  const search = singleParam(params.cari).slice(0, 100);

  let topics: QuestionTopicOption[];
  let questions: ExportQuestionSummary[];

  try {
    const pool = getPostgresPool();
    const values: string[] = [];
    const where: string[] = [];
    if (topicId) {
      values.push(topicId);
      where.push(`q.topic_id = $${values.length}::bigint`);
    }
    if (search) {
      values.push(`%${search.replace(/[%_\\]/g, "\\$&")}%`);
      where.push(`(q.prompt_text ILIKE $${values.length} ESCAPE '\\' OR t.name ILIKE $${values.length} ESCAPE '\\' OR array_to_string(t.tags, ' ') ILIKE $${values.length} ESCAPE '\\')`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [topicResult, questionResult] = await Promise.all([
      pool.query<QuestionTopicOption>("SELECT id::text AS id, name, tags FROM question_topics ORDER BY lower(name), tags_signature, name, id"),
      pool.query<{
        id: string;
        topicId: string;
        topicName: string;
        topicTags: string[];
        promptPreview: string;
        hasPromptImage: boolean;
        optionImageCount: number;
        correctOption: QuestionLetter;
      }>(
        `SELECT q.id::text AS id,
          q.topic_id::text AS "topicId",
          t.name AS "topicName",
          t.tags AS "topicTags",
          left(q.prompt_text, 240) AS "promptPreview",
          (q.prompt_image IS NOT NULL) AS "hasPromptImage",
          ((q.option_a_image IS NOT NULL)::int + (q.option_b_image IS NOT NULL)::int + (q.option_c_image IS NOT NULL)::int + (q.option_d_image IS NOT NULL)::int + (q.option_e_image IS NOT NULL)::int) AS "optionImageCount",
          q.correct_option AS "correctOption"
         FROM question_bank q
         JOIN question_topics t ON t.id = q.topic_id
         ${whereSql}
         ORDER BY q.updated_at DESC, q.id DESC`,
        values,
      ),
    ]);

    topics = topicResult.rows;
    questions = questionResult.rows;
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data modul</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Export Soal Word</h1>
        <Alert variant="destructive" role="alert" className="mt-6 max-w-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Daftar soal belum dapat dimuat</AlertTitle>
          <AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru sudah diterapkan.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex items-start gap-3">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
          <FileOutput className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data modul</p>
          <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Export Soal Word</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
            Ekspor soal pilihan ganda beserta gambar, tabel, rumus, dan kunci jawaban ke dokumen Word (.docx).
          </p>
        </div>
      </div>

      <ExportWordManager
        key={`${topicId}:${search}:${questions.map((q) => q.id).join(",")}`}
        topics={topics}
        questions={questions}
        initialTopicId={topicId}
        initialSearch={search}
      />
    </div>
  );
}
