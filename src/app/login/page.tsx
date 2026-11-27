import { GraduationCap, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { LoginForm } from "@/app/login/login-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { getPublicAppSettingsSafe } from "@/lib/app-settings-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Masuk Admin" };

type LoginPageProps = { searchParams: Promise<{ error?: string; sesi?: string }> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [params, branding] = await Promise.all([searchParams, getPublicAppSettingsSafe()]);
  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-linear-to-b from-accent/80 to-transparent dark:from-accent/30" />
      <div className="absolute right-4 top-4 sm:right-8 sm:top-8"><ThemeToggle /></div>
      <div className="relative w-full max-w-[440px]">
        <div className="mb-8 flex items-center justify-center gap-3">
          {branding.hasLogo ? (
            <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-white p-1 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/branding/logo?v=${branding.revision}`} alt={`Logo ${branding.schoolName || branding.appName}`} className="size-full object-contain" />
            </span>
          ) : (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm"><GraduationCap className="size-6" /></span>
          )}
          <div className="min-w-0">
            <div className="truncate text-xl font-bold tracking-tight">{branding.appName}</div>
            <div className="truncate text-xs text-muted-foreground">{branding.schoolName || branding.appDescription || "Panel ujian sekolah"}</div>
          </div>
        </div>
        <Card className="gap-0 rounded-3xl border border-border bg-card p-6 shadow-[0_12px_50px_rgba(15,45,30,0.07)] sm:p-8">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground"><LockKeyhole className="size-5" /></div>
          <h1 className="mt-5 text-[25px] font-bold tracking-tight">Selamat datang kembali</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Masuk dengan akun admin yang dibuat saat penyiapan {branding.appName}.</p>
          {params.error === "database" && <Alert variant="destructive" className="mt-5" role="alert"><AlertDescription>Database tidak dapat dihubungi. Periksa koneksi dan pengaturan server.</AlertDescription></Alert>}
          {params.sesi === "pemulihan" && (
            <Alert className="mt-5" role="status">
              <AlertDescription>
                Pemulihan database selesai. Masuk kembali menggunakan akun admin yang terdapat pada cadangan tersebut.
              </AlertDescription>
            </Alert>
          )}
          <LoginForm />
        </Card>
        <div className="mt-6 flex items-start justify-center gap-2 text-center text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" /><span>Gunakan HTTPS tepercaya untuk menjaga kredensial di jaringan sekolah.</span></div>
        <p className="mt-4 text-center text-xs text-muted-foreground">Peserta ujian? <Link href="/peserta/login" className="font-semibold text-primary underline underline-offset-4">Masuk sebagai peserta</Link></p>
      </div>
    </main>
  );
}
