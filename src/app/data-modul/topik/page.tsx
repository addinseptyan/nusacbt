import { BookOpenText, CircleAlert } from "lucide-react";

import { TopicManager } from "@/app/data-modul/topik/topic-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { getPostgresPool } from "@/lib/postgres";
import type { QuestionTopic } from "@/lib/topic-types";

export const metadata = { title: "Mata Pelajaran" };
export const dynamic = "force-dynamic";

export default async function TopicsPage() {
  const { allowed, admin } = await requireAdminAccess("topics.manage", "questions.manage");
  if (!allowed || !admin) {
    return <AccessDenied section="Data modul" title="Mata Pelajaran" />;
  }
  const canManageTopics = adminHasPermission(admin, "topics.manage");
  const canManageQuestions = adminHasPermission(admin, "questions.manage");

  let topics: QuestionTopic[];
  try {
    const result = await getPostgresPool().query<QuestionTopic>(
      `SELECT t.id::text AS id, t.name, t.tags, t.xmin::text AS revision, count(q.id)::int AS "questionCount"
       FROM question_topics t
       LEFT JOIN question_bank q ON q.topic_id = t.id
       GROUP BY t.id
       ORDER BY lower(t.name), t.tags_signature, t.name, t.id`,
    );
    topics = result.rows;
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data modul</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Mata Pelajaran</h1>
        <Alert variant="destructive" role="alert" className="mt-6 max-w-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Daftar mata pelajaran belum dapat dimuat</AlertTitle>
          <AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru telah dijalankan dengan <code>npm run db:migrate</code>.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex items-start gap-3">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"><BookOpenText className="size-5" /></span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data modul</p>
          <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Mata Pelajaran</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">Kelola mata pelajaran beserta tag pengelompokan dan buka bank soal per mata pelajaran.</p>
        </div>
      </div>
      <TopicManager topics={topics} canManageTopics={canManageTopics} canManageQuestions={canManageQuestions} />
    </div>
  );
}
