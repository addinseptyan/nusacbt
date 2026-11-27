import { Award, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { ScoreReveal } from "@/components/score-reveal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { participantSharedScores, type ParticipantSharedScores } from "@/lib/participant-auth";
import { participantPageNumber } from "@/lib/participant-login-validation.mjs";

export const metadata = { title: "Nilai yang Dibagikan", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Fallback tanpa JavaScript; dengan JavaScript daftar dibuka di modal /peserta. */
export default async function SharedScoresPage({ searchParams }: { searchParams: Promise<{ halaman?: string | string[] }> }) {
  let data: ParticipantSharedScores | null;
  try { data = await participantSharedScores(participantPageNumber((await searchParams).halaman)); }
  catch { return <main className="mx-auto max-w-2xl p-6"><Alert variant="destructive"><AlertTitle>Nilai belum dapat dimuat</AlertTitle><AlertDescription>Periksa koneksi dan muat ulang halaman.</AlertDescription></Alert><Button asChild variant="outline" className="mt-4"><Link href="/peserta">Kembali ke jadwal</Link></Button></main>; }
  if (!data) redirect("/peserta/login?sesi=berakhir");
  return <main className="min-h-svh bg-[#f6f8f6] p-4 dark:bg-[#101713] sm:p-8"><div className="mx-auto mb-3 flex max-w-2xl justify-end"><ThemeToggle /></div><Card className="mx-auto max-w-2xl gap-0 rounded-[22px] p-5 sm:p-7">
    <div className="flex items-center gap-3"><Award className="size-8 text-emerald-700 dark:text-emerald-300" /><div><h1 className="text-xl font-bold">Nilai yang dibagikan</h1><p className="mt-1 text-xs text-muted-foreground">Nilai pengerjaan yang dibuka pengawas. Nilai akhir tampil setelah ditetapkan dan semua kategori penyumbangnya dibuka.</p></div></div>
    {data.scores.length === 0 ? <p className="mt-5 rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">Belum ada nilai yang dibagikan untuk periode ini.</p>
      : <ul aria-label="Nilai yang dibagikan" className="mt-5 space-y-2">{data.scores.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{item.testName}</p><p className="break-words text-xs text-muted-foreground">{item.type === "final" ? `Nilai akhir · ${item.method === "highest" ? "Tertinggi" : "Rata-rata"}` : `${item.kind === "regular" ? "Reguler" : item.kind === "makeup" ? "Susulan" : "Remidi"} · ${item.runLabel} · Pengerjaan ke-${item.attemptNumber}`}</p></div><ScoreReveal score={item.score} /></li>)}</ul>}
    {data.pages > 1 && <nav aria-label="Halaman nilai" className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs"><span>Halaman {data.page} dari {data.pages}</span><div className="flex gap-2">{data.page > 1 && <Button asChild variant="outline" size="sm"><Link href={`/peserta/nilai?halaman=${data.page - 1}`}><ChevronLeft className="size-4" /> Sebelumnya</Link></Button>}{data.page < data.pages && <Button asChild variant="outline" size="sm"><Link href={`/peserta/nilai?halaman=${data.page + 1}`}>Berikutnya <ChevronRight className="size-4" /></Link></Button>}</div></nav>}
    <Button asChild variant="outline" className="mt-6 w-fit rounded-xl"><Link href="/peserta">Kembali ke jadwal</Link></Button>
  </Card></main>;
}
