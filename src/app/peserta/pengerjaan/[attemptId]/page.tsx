import { CheckCircle2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ExamWork } from "@/app/peserta/pengerjaan/[attemptId]/exam-work";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { validDataId } from "@/lib/class-validation.mjs";
import { examQuestionPosition } from "@/lib/exam-attempt-validation.mjs";
import { loadExamAttempt, type AttemptView } from "@/lib/exam-attempt-work";

export const metadata = { title: "Pengerjaan Tes — NusaCBT", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ attemptId: string }>; searchParams: Promise<{ soal?: string | string[] }> };
export default async function ExamWorkPage({ params, searchParams }: Props) {
  const id = validDataId((await params).attemptId); if (!id) notFound();
  const position = examQuestionPosition((await searchParams).soal) ?? 1;
  let view: AttemptView | "login" | "missing";
  try { view = await loadExamAttempt(id, position); }
  catch {
    return <main className="mx-auto max-w-2xl p-6"><Alert variant="destructive"><TriangleAlert className="size-4" /><AlertTitle>Pengerjaan belum dapat dimuat</AlertTitle><AlertDescription>Periksa koneksi, lalu muat ulang. Jawaban yang belum dikonfirmasi server tidak boleh dianggap tersimpan.</AlertDescription></Alert><Button asChild variant="outline" className="mt-4"><Link href="/peserta">Kembali ke jadwal</Link></Button></main>;
  }
  if (view === "login") redirect("/peserta/login?sesi=berakhir");
  if (view === "missing") notFound();
  if (view.state === "working") return <ExamWork key={`${view.attemptId}:${view.position}:${view.question.revision}:${view.serverNow}`} view={view} />;
  return <main className="min-h-svh bg-[#f6f8f6] px-4 py-12 dark:bg-[#101713]"><Card className="mx-auto max-w-xl gap-0 rounded-[22px] p-6 sm:p-8">
    <CheckCircle2 className="size-10 text-emerald-700 dark:text-emerald-400" />
    <p className="mt-5 text-xs font-semibold text-muted-foreground">PENGERJAAN SELESAI</p><h1 className="mt-1 break-words text-2xl font-bold">{view.testName}</h1><p className="mt-1 break-words text-sm text-muted-foreground">{view.runLabel}</p>
    <p className="mt-5 text-sm leading-6">{view.reason === "time_expired" ? "Waktu tes telah habis. Jawaban terakhir yang tersimpan di server telah dikumpulkan otomatis." : "Jawaban yang tersimpan di server telah dikumpulkan."}</p>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">Nilai tidak ditampilkan otomatis kepada peserta. Hubungi pengawas untuk informasi berikutnya.</p>
    <Button asChild className="mt-6 w-fit rounded-xl"><Link href="/peserta">Kembali ke jadwal</Link></Button>
  </Card></main>;
}
