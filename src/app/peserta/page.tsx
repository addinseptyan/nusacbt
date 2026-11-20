import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, GraduationCap, Info, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { participantLogoutAction } from "@/app/peserta/login/actions";
import { RefreshScheduleButton } from "@/app/peserta/refresh-schedule-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { participantView, type ParticipantView } from "@/lib/participant-auth";
import { participantPageNumber } from "@/lib/participant-login-validation.mjs";

export const metadata = { title: "Ruang Peserta — NusaCBT", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ halaman?: string | string[] }> };

export default async function ParticipantPage({ searchParams }: Props) {
  const params = await searchParams;
  let view: ParticipantView | null;
  try { view = await participantView(participantPageNumber(params.halaman)); }
  catch { redirect("/peserta/login?error=database"); }
  if (!view) redirect("/peserta/login?sesi=berakhir");

  return (
    <main className="min-h-svh bg-[#f6f8f6] dark:bg-[#101713]">
      <header className="border-b bg-card/95">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-emerald-700 text-white"><GraduationCap className="size-5" /></span>
            <div><p className="text-base leading-tight font-bold tracking-tight">NusaCBT</p><p className="text-[11px] text-muted-foreground">Ruang peserta</p></div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <form action={participantLogoutAction}><Button type="submit" variant="outline" className="h-9 rounded-xl px-3 text-xs font-semibold"><LogOut className="size-4" /> Keluar</Button></form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-12 pt-7 sm:px-6 sm:pt-10">
        <section className="relative overflow-hidden rounded-[24px] bg-emerald-800 px-5 py-6 text-white sm:px-8 sm:py-8">
          <div aria-hidden="true" className="absolute -right-10 -top-24 size-64 rounded-full border-[36px] border-white/5" />
          <div aria-hidden="true" className="absolute right-36 -bottom-20 size-40 rounded-full bg-emerald-400/10 blur-2xl" />
          <div className="relative max-w-3xl">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-emerald-200 uppercase"><CheckCircle2 className="size-3.5" /> Berhasil masuk</p>
            <h1 className="mt-3 break-words text-[27px] leading-tight font-bold tracking-[-0.035em] sm:text-[34px]">Halo, {view.studentName}!</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-emerald-50/85">Periksa identitas dan jadwal pada periode yang diaktifkan admin. Jika ada yang tidak sesuai, hubungi pengawas.</p>
          </div>
        </section>

        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,315px)_minmax(0,1fr)]">
          <Card className="gap-0 rounded-[22px] border-border p-5 sm:p-6">
            <div className="flex items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><UserRound className="size-5" /></span><div><h2 className="text-base font-bold">Identitas peserta</h2><p className="text-xs text-muted-foreground">Sesuai periode login</p></div></div>
            <dl className="mt-5 space-y-4 border-t pt-5 text-sm">
              <div><dt className="text-xs text-muted-foreground">Nama</dt><dd className="mt-1 break-words font-semibold">{view.studentName}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Nomor peserta</dt><dd className="mt-1 break-all font-semibold">{view.participantNumber}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Username</dt><dd className="mt-1 break-all font-semibold">{view.username}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Kelas</dt><dd className="mt-1 break-words font-semibold">{view.className}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Periode</dt><dd className="mt-1 break-words font-semibold">{view.periodName}</dd></div>
            </dl>
            <p className="mt-5 rounded-xl bg-muted/60 px-3 py-3 text-xs leading-5 text-muted-foreground">Masuk pada perangkat lain akan mengakhiri sesi di perangkat ini.</p>
          </Card>

          <Card className="min-w-0 gap-0 rounded-[22px] border-border p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"><CalendarDays className="size-5" /></span><div><h2 className="text-base font-bold">Jadwal tes</h2><p className="text-xs leading-5 text-muted-foreground">{view.total} jadwal untukmu dalam periode ini</p></div></div>
              <RefreshScheduleButton page={view.page} />
            </div>
            <Alert className="mt-5 rounded-xl border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <Info className="size-4" /><AlertTitle>Informasi jadwal</AlertTitle>
              <AlertDescription className="text-xs leading-5">Hanya jadwal yang telah dirilis admin untukmu yang ditampilkan. Soal dan tombol mulai belum tersedia.</AlertDescription>
            </Alert>
            {view.tests.length === 0 ? (
              <div className="py-12 text-center"><CalendarDays className="mx-auto size-8 text-muted-foreground/60" /><p className="mt-3 text-sm font-semibold">Belum ada jadwal tes</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Jadwal untuk periode ini akan muncul di sini.</p></div>
            ) : (
              <ul aria-label="Jadwal tes" className="mt-5 space-y-3">
                {view.tests.map((test) => (
                  <li key={test.id} className="min-w-0 rounded-2xl border bg-background p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 break-words text-sm leading-6 font-bold">{test.name}</h3>
                      <Badge variant="outline" className={test.status === "Berlangsung" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : test.status === "Berakhir" ? "bg-muted text-muted-foreground" : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"}>{test.status}</Badge>
                    </div>
                    <p className="mt-1 break-words text-xs text-muted-foreground">{test.kind === "regular" ? "Reguler" : test.kind === "makeup" ? "Susulan" : "Remidi"} · {test.label}</p>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs leading-5 text-muted-foreground">
                      <span className="inline-flex items-start gap-1.5"><CalendarDays className="mt-0.5 size-3.5 shrink-0" /> Mulai {test.startLocal} {test.zone}</span>
                      <span className="inline-flex items-start gap-1.5"><Clock3 className="mt-0.5 size-3.5 shrink-0" /> {test.durationMinutes} menit · berakhir {test.endLocal} {test.zone}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {view.pages > 1 && <nav aria-label="Halaman jadwal" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs">
              <span className="text-muted-foreground">Halaman {view.page} dari {view.pages}</span>
              <div className="flex gap-2">
                {view.page > 1 && <Button asChild variant="outline" size="sm" className="rounded-xl"><Link prefetch={false} href={`/peserta?halaman=${view.page - 1}`}><ChevronLeft className="size-4" /> Sebelumnya</Link></Button>}
                {view.page < view.pages && <Button asChild variant="outline" size="sm" className="rounded-xl"><Link prefetch={false} href={`/peserta?halaman=${view.page + 1}`}>Berikutnya <ChevronRight className="size-4" /></Link></Button>}
              </div>
            </nav>}
          </Card>
        </div>
      </div>
    </main>
  );
}
