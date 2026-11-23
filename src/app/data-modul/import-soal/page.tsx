import Link from "next/link";
import { CircleAlert, FileText } from "lucide-react";

import { QuestionWordImportManager } from "@/app/data-modul/import-soal/question-word-import-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdminAccess } from "@/lib/admin-auth";
import { getPostgresPool } from "@/lib/postgres";
import type { QuestionTopicOption } from "@/lib/question-types";

export const metadata = { title: "Import Soal Word — NusaCBT" };
export const dynamic = "force-dynamic";

export default async function ImportQuestionPage() {
  const { allowed } = await requireAdminAccess("questions.import");
  if (!allowed) {
    return <AccessDenied section="Data modul" title="Import Soal Word" />;
  }
  let topics: QuestionTopicOption[];
  try {
    const result = await getPostgresPool().query<QuestionTopicOption>("SELECT id::text AS id, name FROM question_topics ORDER BY lower(name), name, id");
    topics = result.rows;
  } catch {
    return <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9"><h1 className="text-[29px] font-bold">Import Soal Word</h1><Alert variant="destructive" className="mt-6 max-w-2xl"><CircleAlert className="size-4" /><AlertTitle>Data belum dapat dimuat</AlertTitle><AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru sudah diterapkan. <Link href="/data-modul/soal" className="underline">Kembali ke Manajemen Soal</Link>.</AlertDescription></Alert></div>;
  }
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
    <div className="mb-6 flex items-start gap-3"><span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"><FileText className="size-5" /></span><div><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data modul</p><h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Import Soal Word</h1><p className="mt-2 text-[13px] leading-6 text-muted-foreground">Periksa hasil pembacaan Word sebelum menambahkan soal.</p></div></div>
    <QuestionWordImportManager topics={topics} />
  </div>;
}
