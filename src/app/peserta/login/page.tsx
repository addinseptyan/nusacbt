import { ArrowLeft, BookOpenCheck, CircleAlert, GraduationCap, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import { participantLogoutAction } from "@/app/peserta/login/actions";
import { ParticipantLoginForm } from "@/app/peserta/login/login-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { participantPeriods, type ParticipantPeriod } from "@/lib/participant-auth";

export const metadata = { title: "Masuk Peserta — NusaCBT", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ error?: string; sesi?: string }> };

export default async function ParticipantLoginPage({ searchParams }: Props) {
  const params = await searchParams;
  let periods: ParticipantPeriod[] = []; let available = true;
  try { periods = await participantPeriods(); } catch { available = false; }
  return (
    <main className="relative min-h-svh overflow-hidden bg-[#f5f8f5] px-4 py-7 dark:bg-[#101813] sm:py-10">
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-44 size-96 rounded-full bg-emerald-200/40 blur-3xl dark:bg-emerald-900/25" />
      <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-4">
        <Link href="/peserta/login" className="flex min-w-0 items-center gap-2.5" aria-label="NusaCBT peserta">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-emerald-700 text-white"><GraduationCap className="size-5" /></span>
          <span><span className="block text-base leading-tight font-bold tracking-tight">NusaCBT</span><span className="block text-[11px] font-medium text-muted-foreground">Ruang peserta</span></span>
        </Link>
        <ThemeToggle />
      </div>
      <div className="relative mx-auto grid max-w-5xl items-center gap-8 py-10 md:min-h-[calc(100svh-115px)] md:grid-cols-[1fr_430px] md:gap-16 md:py-12">
        <section className="max-w-lg">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"><Sparkles className="size-3.5" /> RUANG PESERTA</div>
          <h1 className="mt-5 max-w-md text-[34px] leading-[1.12] font-bold tracking-[-0.045em] sm:text-[48px]">Siap belajar,<br /><span className="text-emerald-700 dark:text-emerald-400">siap melangkah.</span></h1>
          <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground sm:text-base">Masuk menggunakan akun dari pengawas untuk melihat identitas dan jadwal pada periode ujianmu.</p>
          <div className="mt-7 flex max-w-md gap-3 rounded-2xl border border-emerald-100 bg-white/75 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200"><BookOpenCheck className="size-5" /></span>
            <div><p className="text-sm font-semibold">Siapkan akun peserta</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Pilih periode yang benar, lalu masukkan username dan kata sandi dari pengawas.</p></div>
          </div>
        </section>
        <Card className="gap-0 rounded-[26px] border border-border bg-card p-6 shadow-[0_20px_70px_rgba(26,75,45,0.08)] sm:p-8">
          <p className="text-[11px] font-bold tracking-[0.13em] text-emerald-700 uppercase dark:text-emerald-400">Selamat datang</p>
          <h2 className="mt-2 text-[25px] font-bold tracking-tight">Masuk sebagai peserta</h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">Gunakan identitas yang sesuai dengan periode ujian.</p>
          {(!available || params.error === "database") && <Alert variant="destructive" className="mt-5" role="alert"><CircleAlert className="size-4" /><AlertDescription>Server belum dapat memuat data. Minta pengelola memeriksa database dan migrasi.</AlertDescription></Alert>}
          {params.error === "logout" && <div className="mt-5 space-y-2"><Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>Sesi belum berhasil diakhiri di server. Jangan tinggalkan perangkat; coba keluar lagi atau hubungi pengawas.</AlertDescription></Alert><form action={participantLogoutAction}><Button type="submit" variant="outline" className="h-9 rounded-xl text-xs">Coba keluar lagi</Button></form></div>}
          {params.sesi === "berakhir" && <Alert className="mt-5" role="status"><CircleAlert className="size-4" /><AlertDescription>Sesi berakhir, data akun berubah, atau akun masuk dari perangkat lain. Silakan masuk kembali.</AlertDescription></Alert>}
          <ParticipantLoginForm periods={periods} available={available} />
          <div className="mt-6 border-t pt-5 text-center"><Link href="/login" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Masuk sebagai admin</Link></div>
        </Card>
      </div>
      <p className="relative mx-auto flex max-w-5xl items-center justify-center gap-2 text-center text-xs leading-5 text-muted-foreground"><ShieldCheck className="size-4 shrink-0" /> Gunakan perangkat dan jaringan yang dipercaya.</p>
    </main>
  );
}
