import { CheckCircle2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ExamWork } from "@/app/peserta/pengerjaan/[attemptId]/exam-work";
import { PreviewSessionSync } from "@/components/preview-session-sync";
import { ThemeToggle } from "@/components/theme-toggle";
import { ScoreReveal } from "@/components/score-reveal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { validDataId } from "@/lib/class-validation.mjs";
import { examQuestionPosition } from "@/lib/exam-attempt-validation.mjs";
import { loadExamAttempt, type AttemptView } from "@/lib/exam-attempt-work";
import { getPreviewParticipantTokenForClient, isPreviewIframeAuthEnabled } from "@/lib/preview-session";

export const metadata = { title: "Pengerjaan Tes", robots: { index: false, follow: false } };
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
  const previewParticipantToken = isPreviewIframeAuthEnabled() ? await getPreviewParticipantTokenForClient() : null;
  if (view.state === "working") {
    return (
      <>
        {previewParticipantToken && <PreviewSessionSync participantAction={{ type: "set", token: previewParticipantToken }} />}
        <ExamWork key={`${view.attemptId}:${view.position}:${view.question.revision}:${view.serverNow}`} view={view} />
      </>
    );
  }
  return <main className="min-h-svh bg-[#f6f8f6] px-4 py-12 dark:bg-[#101713]">
    {previewParticipantToken && <PreviewSessionSync participantAction={{ type: "set", token: previewParticipantToken }} />}<div className="mx-auto mb-3 flex max-w-xl justify-end"><ThemeToggle /></div><Card className="relative mx-auto max-w-xl gap-0 overflow-hidden rounded-[22px] p-6 sm:p-8">
    <div className="completion-sparkles" data-testid="completion-celebration" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</div>
    <CheckCircle2 className="size-10 text-emerald-700 dark:text-emerald-400" />
    <p className="mt-5 text-xs font-semibold text-muted-foreground">PENGERJAAN SELESAI</p><h1 className="mt-1 break-words text-2xl font-bold">{view.testName}</h1>{view.testTags.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{view.testTags.map((tag) => <Badge key={tag} variant="secondary" className="rounded-full px-2 py-0 text-[10px]">{tag}</Badge>)}</div>}<p className="mt-1 break-words text-sm text-muted-foreground">{view.runLabel}</p>
    <p className="mt-5 text-sm leading-6">{view.reason === "time_expired" ? "Waktu tes telah habis. Jawaban terakhir yang tersimpan di server telah dikumpulkan otomatis." : "Jawaban yang tersimpan di server telah dikumpulkan."}</p>
    {view.score !== null ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40"><p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">Nilai pengerjaan</p><ScoreReveal score={view.score} /><p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">Nilai satu pengerjaan, bukan nilai akhir gabungan.</p></div>
      : <p className="mt-3 text-sm leading-6 text-muted-foreground">Nilai belum dibagikan oleh pengawas.</p>}
    <Button asChild className="mt-6 w-fit rounded-xl"><Link href="/peserta">Kembali ke jadwal</Link></Button>
  </Card></main>;
}
