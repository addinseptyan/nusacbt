import {
  ArrowDownToLine,
  ArrowRight,
  BookOpenText,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Info,
  Layers3,
  LockKeyhole,
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

const summary = [
  { title: "Peserta terdaftar", icon: UsersRound, color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300" },
  { title: "Bank soal", icon: BookOpenText, color: "bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300" },
  { title: "Tes aktif", icon: ClipboardList, color: "bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300" },
  { title: "Laporan hasil", icon: Layers3, color: "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300" },
];

const steps = [
  { number: "01", title: "Tinjau template impor", detail: "Contoh Word dan Excel sudah tersedia untuk diperiksa.", status: "Tersedia", icon: CheckCircle2, color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300" },
  { number: "02", title: "Siapkan data sekolah", detail: "Periode, kelas, siswa, impor Excel, serta nomor dan username per periode tersedia.", status: "Sebagian tersedia", icon: CircleDashed, color: "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300" },
  { number: "03", title: "Susun bank soal", detail: "Topik, soal berformat dan gambar dapat dikelola; impor Word tersedia untuk format terbatas.", status: "Sebagian tersedia", icon: CircleDashed, color: "bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300" },
  { number: "04", title: "Atur dan jalankan tes", detail: "Siapkan jadwal, token, durasi, serta monitoring.", status: "Direncanakan", icon: CircleDashed, color: "bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300" },
];

const cardClass = "rounded-[18px] bg-card ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]";

export default async function DashboardPage() {
  await requireAdmin();
  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2.5 flex items-center gap-2 text-[10px] font-bold tracking-[0.15em] text-primary uppercase"><span className="h-px w-5 bg-primary/60" /> Panel ujian sekolah</div>
          <h1 className="text-[24px] leading-tight font-bold tracking-[-0.045em] text-foreground sm:text-[31px]">Selamat datang di NusaCBT <span aria-hidden="true">👋</span></h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">Satu ruang untuk menyiapkan ujian sekolah dengan lebih tertata.</p>
        </div>
        <ProjectDialog />
      </div>

      <Alert className="mb-7 rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200">
        <Info className="size-4 text-[#727fc8] dark:text-indigo-300" />
        <AlertTitle className="text-[12px] font-bold">Anda sedang melihat pratinjau awal</AlertTitle>
        <AlertDescription className="mt-0.5 text-[12px] leading-5 text-[#6873a0] dark:text-indigo-200/70">Login admin, topik/mata pelajaran, soal manual, impor Word terbatas, pengelolaan siswa, impor Excel, serta identitas dan sandi peserta per periode tersedia. Login peserta, ujian, dan statistik masih belum aktif.</AlertDescription>
      </Alert>

      <div className="mb-3.5 flex items-center justify-between">
        <div><h2 className="text-[15px] font-bold tracking-[-0.025em]">Ringkasan</h2><p className="mt-1 text-[11px] text-muted-foreground">Gambaran data sekolah akan muncul di sini.</p></div>
        <Badge variant="outline" className="h-6 rounded-full border-border bg-card px-2.5 text-[10px] font-semibold text-muted-foreground">BELUM TERHUBUNG</Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.title} className={`${cardClass} gap-0 p-4 sm:p-5`}>
              <div className="flex items-start justify-between gap-3">
                <span className="pt-0.5 text-[12px] font-semibold text-muted-foreground">{item.title}</span>
                <span className={`flex size-10 items-center justify-center rounded-xl ${item.color}`}><Icon className="size-[19px]" /></span>
              </div>
              <div className="mt-0.5 text-[30px] leading-none font-semibold tracking-[-0.05em] text-foreground">—</div>
              <div className="mt-3 text-[11px] text-muted-foreground">Menunggu integrasi data</div>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(310px,0.9fr)]">
        <Card className={`${cardClass} gap-0 p-5 sm:p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-[#eaf7ef] text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"><GraduationCap className="size-4" /></span><h2 className="text-[15px] font-bold tracking-[-0.025em]">Mulai dari sini</h2></div>
              <p className="mt-2 text-[12px] leading-5 text-muted-foreground">Langkah sederhana untuk mempersiapkan lingkungan ujian.</p>
            </div>
            <Badge variant="outline" className="h-6 rounded-full bg-card px-2.5 text-[10px] font-medium text-muted-foreground">4 tahap</Badge>
          </div>
          <div className="mt-5 divide-y divide-border">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.number} className="flex items-center gap-3 py-4 first:pt-0 last:pb-0 sm:gap-4">
                  <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${step.color}`}><Icon className="size-[18px]" /></span>
                  <div className="min-w-0 flex-1"><p className="text-[12px] font-semibold text-foreground sm:text-[13px]">{step.title}</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{step.detail}</p></div>
                  <span className="hidden text-[10px] font-semibold text-muted-foreground sm:block">{step.status}</span>
                  <span className="hidden text-[11px] font-bold text-muted-foreground/40 sm:block">{step.number}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className={`${cardClass} gap-0 p-5 sm:p-6`}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-[10px] font-bold tracking-[0.12em] text-primary uppercase">Berkas contoh</p><h2 className="mt-2 text-[17px] leading-6 font-bold tracking-[-0.035em]">Template siap ditinjau</h2></div>
              <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"><FileText className="size-5" /></span>
            </div>
            <p className="mt-2 text-[12px] leading-5 text-muted-foreground">Dibuat dari referensi PDF dengan data fiktif. Impor peserta dan impor soal Word terbatas tersedia untuk diuji.</p>
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

          <Card className="gap-0 rounded-[18px] bg-[#eaf7ef] p-4 ring-1 ring-[#dcefe3] dark:bg-emerald-950/30 dark:ring-emerald-900/50">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm dark:bg-emerald-900/60 dark:text-emerald-300"><WifiOff className="size-4" /></span>
              <div><p className="text-[12px] font-bold text-emerald-900 dark:text-emerald-200">Dirancang untuk jaringan lokal</p><p className="mt-1 text-[11px] leading-[1.6] text-emerald-800/70 dark:text-emerald-200/70">Aplikasi ditujukan tetap berjalan di LAN tanpa internet. Pengujian di server sekolah masih diperlukan.</p></div>
            </div>
          </Card>
        </div>
      </div>

      <Card className={`${cardClass} mt-4 gap-0 p-5 sm:p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300"><CalendarDays className="size-[18px]" /></span><div><h2 className="text-[14px] font-bold">Jadwal ujian</h2><p className="mt-1 text-[11px] text-muted-foreground">Pantau jadwal dari satu tempat.</p></div></div>
          <Button asChild variant="ghost" className="h-9 rounded-lg text-[11px] font-semibold text-primary"><Link href="/data-tes/daftar">Lihat daftar tes <ArrowRight className="size-3.5" /></Link></Button>
        </div>
        <div className="mt-5 flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-4 py-7 text-center">
          <LockKeyhole className="size-5 text-muted-foreground/55" />
          <p className="mt-2 text-[12px] font-semibold text-foreground">Belum ada data yang ditampilkan</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Jadwal tersedia setelah fitur tes dan database dihubungkan.</p>
        </div>
      </Card>
      <p className="mt-6 text-[10px] text-muted-foreground/75">NusaCBT · Fondasi antarmuka untuk sekolah</p>
    </div>
  );
}
