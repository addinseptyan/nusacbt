import { ArrowLeft, Clock3, KeyRound } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { StartForm } from "@/app/peserta/jadwal/[runId]/start-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { validDataId } from "@/lib/class-validation.mjs";
import { loadExamStartScreen } from "@/lib/exam-start-screen";

export const metadata = { title: "Mulai Tes", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function StartExamPage({ params }: { params: Promise<{ runId: string }> }) {
  const id = validDataId((await params).runId); if (!id) notFound();
  const screen = await loadExamStartScreen(id);
  if (!screen) redirect("/peserta/login?sesi=berakhir");
  if (!screen.runId) notFound();
  if (screen.attemptId && !screen.retakePermissionId) redirect(`/peserta/pengerjaan/${screen.attemptId}`);
  return <main className="min-h-svh bg-[#f6f8f6] px-4 py-6 dark:bg-[#101713]">
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Button asChild variant="ghost" className="rounded-xl"><Link href="/peserta"><ArrowLeft className="size-4" /> Jadwal saya</Link></Button>
        <ThemeToggle />
      </div>
      <Card className="gap-0 rounded-[22px] p-5 sm:p-8">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"><KeyRound className="size-5" /></span>
          <div className="min-w-0"><p className="text-xs font-semibold text-muted-foreground">PERSIAPAN TES</p><h1 className="mt-1 break-words text-2xl font-bold">{screen.name}</h1><p className="mt-1 break-words text-sm text-muted-foreground">{screen.label}</p></div>
        </div>
        <div className="mt-6 flex items-start gap-2 rounded-xl bg-muted/60 p-4 text-sm leading-6">
          <Clock3 className="mt-1 size-4 shrink-0" /><div><p>Jadwal: {screen.startLocal}–{screen.endLocal} {screen.zone}</p><p>Durasi {screen.duration} menit. Waktu berakhir tetap sesuai jadwal, bukan dihitung ulang saat mulai.</p></div>
        </div>
        {screen.finalized ? <Alert className="mt-5"><AlertTitle>Pengerjaan baru ditutup</AlertTitle><AlertDescription>Hubungi pengawas jika kesempatan perlu dibuka kembali.</AlertDescription></Alert> : screen.status === "active" ? <>
          <Alert className="mt-5"><AlertTitle>{screen.retakePermissionId ? "Izin mengulang tersedia" : "Sebelum mulai"}</AlertTitle><AlertDescription>{screen.retakePermissionId ? "Satu izin untuk satu pengulangan. Pengerjaan sebelumnya tetap tersimpan; soal dan urutan sama, jawaban baru dimulai kosong. Batas akhir tidak berubah. " : ""}Pastikan koneksi tersedia. Jawaban aman hanya setelah ada konfirmasi tersimpan di server. Ketika waktu habis, hanya jawaban yang tersimpan yang dinilai.</AlertDescription></Alert>
          <StartForm runId={screen.runId} testName={screen.name ?? undefined} runLabel={screen.label ?? undefined} retakePermissionId={screen.retakePermissionId} finalRevision={screen.finalRevision} />
        </> : <Alert className="mt-5"><AlertTitle>{screen.status === "future" ? "Tes belum dimulai" : "Waktu tes sudah berakhir"}</AlertTitle><AlertDescription>Hubungi pengawas jika jadwal perlu diperiksa.</AlertDescription></Alert>}
      </Card>
    </div>
  </main>;
}
