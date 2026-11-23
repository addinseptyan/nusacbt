import {
  ArrowDownToLine,
  ArrowRight,
  BookOpenText,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  ClipboardList,
  Clock3,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Layers3,
  Settings2,
  UsersRound,
  WifiOff,
} from "lucide-react";
import Link from "next/link";

import { ProjectDialog } from "@/components/project-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { getPublicAppSettingsSafe } from "@/lib/app-settings-service";
import { loadDashboardSummary, type DashboardSummary } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

const cardClass = "rounded-[18px] bg-card ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]";

export default async function DashboardPage() {
  const admin = await requireAdmin();
  const canManageAppSettings = adminHasPermission(admin, "app_settings.manage");
  const [branding, summaryResult] = await Promise.all([
    getPublicAppSettingsSafe(),
    loadDashboardSummary().then(
      (data) => ({ ok: true as const, data }),
      () => ({ ok: false as const }),
    ),
  ]);

  const data: DashboardSummary | null = summaryResult.ok ? summaryResult.data : null;

  const summaryCards = [
    {
      title: "Peserta terdaftar",
      value: data ? String(data.totalStudents) : "—",
      detail: data
        ? data.activeYearName
          ? `${data.activeYearStudents} aktif di ${data.activeYearName}`
          : `${data.activeLoginAccounts} akun periode login`
        : "Database belum tersedia",
      href: "/data-peserta/siswa",
      icon: UsersRound,
      color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300",
    },
    {
      title: "Bank soal",
      value: data ? String(data.totalQuestions) : "—",
      detail: data ? `${data.totalTopics} topik · ${data.questionsWithImages} bergambar` : "Database belum tersedia",
      href: "/data-modul/soal",
      icon: BookOpenText,
      color: "bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300",
    },
    {
      title: "Tes aktif",
      value: data ? String(data.liveRuns) : "—",
      detail: data ? `${data.totalTests} rancangan · ${data.activeTokens} token aktif` : "Database belum tersedia",
      href: "/data-tes/daftar",
      icon: ClipboardList,
      color: "bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300",
    },
    {
      title: "Laporan hasil",
      value: data ? String(data.completedAttempts) : "—",
      detail: data
        ? `${data.finalizedGrades} nilai ditetapkan · ${data.activeAttempts} sedang dikerjakan`
        : "Database belum tersedia",
      href: "/laporan/rekap",
      icon: Layers3,
      color: "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300",
    },
  ];

  const steps = data
    ? [
        {
          number: "01",
          title: "Tahun ajaran & periode ujian",
          detail: data.activeYearName
            ? `Tahun aktif ${data.activeYearName}${data.loginPeriodName ? ` · login ${data.loginPeriodName}` : " · login periode belum aktif"}.${data.unmappedPeriods > 0 ? ` ${data.unmappedPeriods} periode belum dipetakan.` : ""}`
            : "Belum ada tahun ajaran aktif. Buat dan aktifkan di menu Tahun Ajaran.",
          status: data.activeYearName && data.loginPeriodName && data.unmappedPeriods === 0 ? "Siap" : "Perlu diatur",
          ready: Boolean(data.activeYearName && data.loginPeriodName && data.unmappedPeriods === 0),
          href: data.activeYearName ? "/data-peserta/periode" : "/data-peserta/tahun-ajaran",
          color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300",
        },
        {
          number: "02",
          title: "Data siswa & akun peserta",
          detail: `${data.totalStudents} siswa terdaftar · ${data.activeLoginAccounts} akun siap cetak/login · ${data.activeParticipantSessions} sesi aktif sekarang.`,
          status: data.activeLoginAccounts > 0 ? "Tersedia" : "Belum ada akun",
          ready: data.activeLoginAccounts > 0,
          href: "/data-peserta/akun",
          color: "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300",
        },
        {
          number: "03",
          title: "Susun & ekspor bank soal",
          detail: `${data.totalQuestions} soal pada ${data.totalTopics} topik tersedia; mendukung impor dan ekspor Word (.docx).`,
          status: data.totalQuestions > 0 ? "Tersedia" : "Kosong",
          ready: data.totalQuestions > 0,
          href: "/data-modul/soal",
          color: "bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300",
        },
        {
          number: "04",
          title: "Jadwal, token & monitoring tes",
          detail: `${data.publishedRuns} pelaksanaan dirilis · ${data.liveRuns} berlangsung · ${data.waitingAttempts} lewat batas menunggu penyelesaian.`,
          status: data.publishedRuns > 0 ? "Terjadwal" : "Belum dirilis",
          ready: data.publishedRuns > 0,
          href: "/data-tes/monitoring",
          color: "bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300",
        },
      ]
    : [];

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2.5 flex items-center gap-2 text-[10px] font-bold tracking-[0.15em] text-primary uppercase">
            <span className="h-px w-5 bg-primary/60" /> {branding.schoolName || "Panel ujian sekolah"}
          </div>
          <h1 className="text-[24px] leading-tight font-bold tracking-[-0.045em] text-foreground sm:text-[31px]">
            Selamat datang di {branding.appName} <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
            {branding.appDescription || "Satu ruang untuk menyiapkan ujian sekolah dengan lebih tertata."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManageAppSettings && (
            <Button asChild variant="outline" className="h-10 rounded-xl bg-card px-4 font-semibold">
              <Link href="/pengaturan/aplikasi" prefetch={false}><Settings2 className="size-4" /> Pengaturan aplikasi</Link>
            </Button>
          )}
          <ProjectDialog />
        </div>
      </div>

      {!data ? (
        <Alert variant="destructive" className="mb-7 rounded-2xl" role="alert">
          <CircleAlert className="size-4" />
          <AlertTitle>Ringkasan database belum dapat dimuat</AlertTitle>
          <AlertDescription>Pastikan PostgreSQL aktif dan migrasi terbaru telah dijalankan dengan <code>npm run db:migrate</code>.</AlertDescription>
        </Alert>
      ) : (!data.activeYearName || !data.loginPeriodName || data.unmappedPeriods > 0 || data.waitingAttempts > 0) ? (
        <Alert className="mb-7 rounded-2xl border-amber-200 bg-amber-50/75 px-4 py-3 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <CircleAlert className="size-4 text-amber-700 dark:text-amber-300" />
          <AlertTitle className="text-[12px] font-bold">Perlu pemeriksaan awal sebelum ujian</AlertTitle>
          <AlertDescription className="mt-0.5 text-[12px] leading-5">
            {!data.activeYearName && <>Tahun ajaran aktif belum dipilih (<Link href="/data-peserta/tahun-ajaran" prefetch={false} className="font-semibold underline">Atur tahun ajaran</Link>). </>}
            {data.unmappedPeriods > 0 && <>{data.unmappedPeriods} periode lama belum dipetakan ke tahun ajaran (<Link href="/data-peserta/periode" prefetch={false} className="font-semibold underline">Petakan periode</Link>). </>}
            {!data.loginPeriodName && <>Periode login peserta belum aktif (<Link href="/data-peserta/periode" prefetch={false} className="font-semibold underline">Aktifkan login periode</Link>). </>}
            {data.waitingAttempts > 0 && <>{data.waitingAttempts} pengerjaan melewati batas waktu (<Link href="/data-tes/monitoring" prefetch={false} className="font-semibold underline">Periksa monitoring</Link>).</>}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="mb-7 rounded-2xl border-border bg-accent/60 px-4 py-3 text-accent-foreground">
          <CheckCircle2 className="size-4 text-primary" />
          <AlertTitle className="text-[12px] font-bold">Lingkungan siap untuk pengujian</AlertTitle>
          <AlertDescription className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
            Tahun ajaran aktif <strong>{data.activeYearName}</strong> · Periode login <strong>{data.loginPeriodName}</strong> · {data.activeParticipantSessions} sesi peserta aktif.
          </AlertDescription>
        </Alert>
      )}

      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold tracking-[-0.025em]">Ringkasan database</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">Data langsung dari PostgreSQL sekolah.</p>
        </div>
        <Badge variant="outline" className="h-6 rounded-full border-border bg-accent/70 px-2.5 text-[10px] font-semibold text-accent-foreground">
          {data ? "TERHUBUNG" : "TERPUTUS"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.title} href={item.href} prefetch={false} className="group block focus:outline-none">
              <Card className={`${cardClass} gap-0 p-4 transition group-hover:border-primary/40 sm:p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <span className="pt-0.5 text-[12px] font-semibold text-muted-foreground">{item.title}</span>
                  <span className={`flex size-10 items-center justify-center rounded-xl ${item.color}`}><Icon className="size-[19px]" /></span>
                </div>
                <div className="mt-0.5 text-[30px] leading-none font-semibold tracking-[-0.05em] text-foreground">{item.value}</div>
                <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{item.detail}</span>
                  <ArrowRight className="size-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="mt-6 grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(310px,0.9fr)]">
        <Card className={`${cardClass} gap-0 p-5 sm:p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"><GraduationCap className="size-4" /></span>
                <h2 className="text-[15px] font-bold tracking-[-0.025em]">Kesiapan ujian</h2>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-muted-foreground">Ringkasan status tiap tahap persiapan ujian.</p>
            </div>
            <Badge variant="outline" className="h-6 rounded-full bg-card px-2.5 text-[10px] font-medium text-muted-foreground">4 tahap</Badge>
          </div>
          {steps.length > 0 ? (
            <div className="mt-5 divide-y divide-border">
              {steps.map((step) => {
                const Icon = step.ready ? CheckCircle2 : CircleDashed;
                return (
                  <Link key={step.number} href={step.href} prefetch={false} className="group flex items-center gap-3 py-4 first:pt-0 last:pb-0 sm:gap-4">
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${step.color}`}><Icon className="size-[18px]" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-foreground group-hover:text-primary sm:text-[13px]">{step.title}</p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{step.detail}</p>
                    </div>
                    <Badge variant={step.ready ? "secondary" : "outline"} className="hidden text-[10px] font-semibold sm:inline-flex">{step.status}</Badge>
                    <span className="hidden text-[11px] font-bold text-muted-foreground/40 sm:block">{step.number}</span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="mt-5 text-xs text-muted-foreground">Sambungkan database untuk melihat status persiapan ujian.</p>
          )}
        </Card>

        <div className="space-y-4">
          <Card className={`${cardClass} gap-0 p-5 sm:p-6`}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-[10px] font-bold tracking-[0.12em] text-primary uppercase">Berkas contoh</p><h2 className="mt-2 text-[17px] leading-6 font-bold tracking-[-0.035em]">Template siap ditinjau</h2></div>
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground"><FileText className="size-5" /></span>
            </div>
            <p className="mt-2 text-[12px] leading-5 text-muted-foreground">Format impor dan ekspor peserta serta soal Word memakai berkas berikut.</p>
            <div className="mt-4 space-y-2">
              <a href="/templates/template-soal-nusacbt.docx" download className="flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-muted/60">
                <span className="flex size-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"><FileText className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold">Template soal</span><span className="mt-0.5 block text-[10px] text-muted-foreground">Word · .docx</span></span>
                <ArrowDownToLine className="size-4 text-muted-foreground" />
              </a>
              <a href="/templates/template-peserta-nusacbt.xlsx" download className="flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-muted/60">
                <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"><FileSpreadsheet className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold">Template peserta</span><span className="mt-0.5 block text-[10px] text-muted-foreground">Excel · .xlsx</span></span>
                <ArrowDownToLine className="size-4 text-muted-foreground" />
              </a>
            </div>
          </Card>

          <Card className="gap-0 rounded-[18px] bg-accent/70 p-4 ring-1 ring-border">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-xs"><WifiOff className="size-4" /></span>
              <div>
                <p className="text-[12px] font-bold text-foreground">Dirancang untuk jaringan lokal</p>
                <p className="mt-1 text-[11px] leading-[1.6] text-muted-foreground">Tetap berjalan di LAN tanpa internet setelah dependensi terpasang. Uji beban pada server target disarankan sebelum hari ujian.</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card className={`${cardClass} mt-4 gap-0 p-5 sm:p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300"><CalendarDays className="size-[18px]" /></span>
            <div>
              <h2 className="text-[14px] font-bold">Jadwal pelaksanaan berlangsung &amp; mendatang</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">Pelaksanaan yang sudah dirilis dan belum berakhir.</p>
            </div>
          </div>
          <Button asChild variant="ghost" className="h-9 rounded-lg text-[11px] font-semibold text-primary">
            <Link href="/data-tes/daftar" prefetch={false}>Lihat daftar tes <ArrowRight className="size-3.5" /></Link>
          </Button>
        </div>
        {data && data.schedules.length > 0 ? (
          <ul className="mt-4 divide-y divide-border" aria-label="Jadwal pelaksanaan aktif dan mendatang">
            {data.schedules.map((item) => (
              <li key={item.runId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/data-tes/daftar/${item.examTestId}`} prefetch={false} className="truncate text-sm font-semibold hover:text-primary hover:underline">
                      {item.testName}
                    </Link>
                    <Badge variant={item.live ? "default" : "outline"} className="text-[10px]">
                      {item.live ? "Berlangsung" : "Terjadwal"}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {item.kind === "regular" ? "Reguler" : item.kind === "makeup" ? "Susulan" : "Remidi"}
                    </Badge>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{item.runLabel}</span>
                    <span className="inline-flex items-center gap-1"><Clock3 className="size-3" /> {item.startLocal}–{item.endLocal} {item.timeZone} ({item.durationMinutes} mnt)</span>
                    <span>{item.participantCount} peserta</span>
                  </p>
                </div>
                <Button asChild variant="outline" size="sm" className="rounded-lg text-xs">
                  <Link href={`/data-tes/daftar/${item.examTestId}`} prefetch={false}>Kelola</Link>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-5 flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-4 py-7 text-center">
            <CalendarDays className="size-5 text-muted-foreground/55" />
            <p className="mt-2 text-[12px] font-semibold text-foreground">Belum ada jadwal pelaksanaan aktif atau mendatang</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Buat tes dan rilis pelaksanaan di menu Daftar Tes.</p>
          </div>
        )}
      </Card>
      <p className="mt-6 text-[10px] text-muted-foreground/75">{branding.appName}{branding.schoolName ? ` · ${branding.schoolName}` : ""}</p>
    </div>
  );
}
