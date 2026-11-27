import { BookOpenCheck, CircleAlert } from "lucide-react";

import { QuestionManager } from "@/app/data-modul/soal/question-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdminAccess } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";
import type { Question, QuestionLetter, QuestionTopicOption } from "@/lib/question-types";

export const metadata = { title: "Bank Soal" };
export const dynamic = "force-dynamic";

type QuestionRow = {
  id: string; revision: string; topicId: string; topicName: string; topicTags: string[];
  prompt: string; promptRich: unknown | null; hasPromptImage: boolean;
  a: string; b: string; c: string; d: string; e: string;
  richA: unknown | null; richB: unknown | null; richC: unknown | null; richD: unknown | null; richE: unknown | null;
  hasA: boolean; hasB: boolean; hasC: boolean; hasD: boolean; hasE: boolean;
  correctOption: QuestionLetter;
};

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ topik?: string | string[] }>;
}) {
  const { allowed } = await requireAdminAccess("questions.manage");
  if (!allowed) {
    return <AccessDenied section="Data modul" title="Bank Soal" />;
  }
  const params = await searchParams;
  const rawTopic = Array.isArray(params.topik) ? params.topik[0] : params.topik;
  const requestedTopicId = validDataId(rawTopic ?? "") ?? "";

  let topics: QuestionTopicOption[];
  let questions: Question[];
  try {
    const pool = getPostgresPool();
    const [topicResult, questionResult] = await Promise.all([
      pool.query<QuestionTopicOption>("SELECT id::text AS id, name, tags FROM question_topics ORDER BY lower(name), tags_signature, name, id"),
      pool.query<QuestionRow>(
        `SELECT q.id::text AS id, q.xmin::text AS revision, q.topic_id::text AS "topicId", t.name AS "topicName", t.tags AS "topicTags",
         q.prompt_text AS prompt, q.prompt_rich AS "promptRich", q.prompt_image IS NOT NULL AS "hasPromptImage",
         q.option_a_text AS a, q.option_b_text AS b, q.option_c_text AS c, q.option_d_text AS d, q.option_e_text AS e,
         q.option_a_rich AS "richA", q.option_b_rich AS "richB", q.option_c_rich AS "richC", q.option_d_rich AS "richD", q.option_e_rich AS "richE",
         q.option_a_image IS NOT NULL AS "hasA", q.option_b_image IS NOT NULL AS "hasB", q.option_c_image IS NOT NULL AS "hasC",
         q.option_d_image IS NOT NULL AS "hasD", q.option_e_image IS NOT NULL AS "hasE", q.correct_option AS "correctOption"
         FROM question_bank q JOIN question_topics t ON t.id=q.topic_id ORDER BY q.updated_at DESC, q.id DESC`,
      ),
    ]);
    topics = topicResult.rows;
    questions = questionResult.rows.map((row) => ({
      id: row.id, revision: row.revision, topicId: row.topicId, topicName: row.topicName, topicTags: row.topicTags ?? [],
      prompt: row.prompt, promptRich: row.promptRich, hasPromptImage: row.hasPromptImage, correctOption: row.correctOption,
      options: [
        { letter: "A", text: row.a, rich: row.richA, hasImage: row.hasA }, { letter: "B", text: row.b, rich: row.richB, hasImage: row.hasB },
        { letter: "C", text: row.c, rich: row.richC, hasImage: row.hasC }, { letter: "D", text: row.d, rich: row.richD, hasImage: row.hasD },
        { letter: "E", text: row.e, rich: row.richE, hasImage: row.hasE },
      ],
    }));
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data modul</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Bank Soal</h1>
        <Alert variant="destructive" role="alert" className="mt-6 max-w-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Daftar soal belum dapat dimuat</AlertTitle>
          <AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru telah dijalankan dengan <code>npm run db:migrate</code>.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const initialTopicId = requestedTopicId && topics.some((topic) => topic.id === requestedTopicId) ? requestedTopicId : "";
  const activeTopic = initialTopicId ? topics.find((topic) => topic.id === initialTopicId) ?? null : null;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex items-start gap-3">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"><BookOpenCheck className="size-5" /></span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data modul · Mata Pelajaran</p>
          <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Bank Soal{activeTopic ? ` · ${activeTopic.name}` : ""}</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">Susun bank soal pilihan ganda berdasarkan mata pelajaran, dengan teks berformat dan tabel.</p>
        </div>
      </div>
      <QuestionManager key={initialTopicId} topics={topics} questions={questions} initialTopicId={initialTopicId} />
    </div>
  );
}
