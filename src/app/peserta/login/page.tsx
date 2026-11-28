import { ArrowLeft, BookOpenCheck, CircleAlert, GraduationCap, Info, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import { participantLogoutAction } from "@/app/peserta/login/actions";
import { ParticipantLoginForm } from "@/app/peserta/login/login-form";
import { PreviewSessionSync } from "@/components/preview-session-sync";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getPublicAppSettingsSafe } from "@/lib/app-settings-service";
import { activeParticipantLoginPeriods, type ActiveLoginPeriod } from "@/lib/participant-auth";
import { isPreviewIframeAuthEnabled } from "@/lib/preview-session";

export const metadata = { title: "Masuk Peserta", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ error?: string; sesi?: string }> };

export default async function ParticipantLoginPage({ searchParams }: Props) {
  const previewAuth = isPreviewIframeAuthEnabled();
  const [params, branding] = await Promise.all([searchParams, getPublicAppSettingsSafe()]);
  let activePeriods: ActiveLoginPeriod[] = [];
  let available = true;
  try {
    activePeriods = await activeParticipantLoginPeriods();
  } catch {
    available = false;
  }
  return (
    <main className="relative min-h-svh overflow-hidden bg-background px-4 py-7 sm:py-10">
      {previewAuth && <PreviewSessionSync participantAction={{ type: "clear" }} />}
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-44 size-96 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-4">
        <Link href="/peserta/login" className="flex min-w-0 items-center gap-2.5" aria-label={`${branding.appName} peserta`}>
          {branding.hasLogo ? (
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-border bg-white p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/branding/logo?v=${branding.revision}`} alt={`Logo ${branding.schoolName || branding.appName}`} className="size-full object-contain" />
            </span>
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-primary text-primary-foreground"><GraduationCap className="size-5" /></span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-base leading-tight font-bold tracking-tight">{branding.appName}</span>
            <span className="block truncate text-[11px] font-medium text-muted-foreground">{branding.schoolName || "Ruang peserta"}</span>
          </span>
        </Link>
        <ThemeToggle />
      </div>
      <div className="relative mx-auto grid max-w-5xl items-center gap-8 py-10 md:min-h-[calc(100svh-115px)] md:grid-cols-[1fr_430px] md:gap-16 md:py-12">
        <section className="max-w-lg">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-accent/80 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-accent-foreground"><Sparkles className="size-3.5" /> {branding.schoolName ? branding.schoolName.toUpperCase() : "RUANG PESERTA"}</div>
          <h1 className="mt-5 max-w-md text-[34px] leading-[1.12] font-bold tracking-[-0.045em] sm:text-[48px]">Siap belajar,<br /><span className="text-primary">siap melangkah.</span></h1>
          <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground sm:text-base">Masuk menggunakan akun dari pengawas untuk melihat identitas dan jadwal pada periode ujianmu.</p>
          {branding.participantInfo ? (
            <div className="mt-7 flex max-w-md gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs" data-testid="participant-login-info">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Info className="size-5" /></span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Informasi untuk peserta</p>
                <p className="mt-1 whitespace-pre-line break-words text-xs leading-5 text-muted-foreground">{branding.participantInfo}</p>
              </div>
            </div>
          ) : (
            <div className="mt-7 flex max-w-md gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><BookOpenCheck className="size-5" /></span>
              <div><p className="text-sm font-semibold">Siapkan akun peserta</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Masukkan username dan kata sandi dari pengawas.</p></div>
            </div>
          )}
        </section>
        <Card className="gap-0 rounded-[26px] border border-border bg-card p-6 shadow-[0_20px_70px_rgba(26,75,45,0.08)] sm:p-8">
          <p className="text-[11px] font-bold tracking-[0.13em] text-primary uppercase">Selamat datang</p>
          <h2 className="mt-2 text-[25px] font-bold tracking-tight">Masuk sebagai peserta</h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">Gunakan identitas yang sesuai dengan periode ujian.</p>
          {(!available || params.error === "database") && <Alert variant="destructive" className="mt-5" role="alert"><CircleAlert className="size-4" /><AlertDescription>Server belum dapat memuat data. Minta pengelola memeriksa database dan migrasi.</AlertDescription></Alert>}
          {params.error === "logout" && <div className="mt-5 space-y-2"><Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>Sesi belum berhasil diakhiri di server. Jangan tinggalkan perangkat; coba keluar lagi atau hubungi pengawas.</AlertDescription></Alert><form action={participantLogoutAction}><Button type="submit" variant="outline" className="h-9 rounded-xl text-xs">Coba keluar lagi</Button></form></div>}
          {params.sesi === "berakhir" && <Alert className="mt-5" role="status"><CircleAlert className="size-4" /><AlertDescription>Sesi berakhir, periode atau data akun berubah, atau akun masuk dari perangkat lain. Silakan masuk kembali.</AlertDescription></Alert>}
          <ParticipantLoginForm activePeriods={activePeriods} available={available} />
          <div className="mt-6 border-t pt-5 text-center"><Link href="/login" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Masuk sebagai admin</Link></div>
        </Card>
      </div>
      <p className="relative mx-auto flex max-w-5xl items-center justify-center gap-2 text-center text-xs leading-5 text-muted-foreground"><ShieldCheck className="size-4 shrink-0" /> Gunakan perangkat dan jaringan yang dipercaya.</p>
    </main>
  );
}
