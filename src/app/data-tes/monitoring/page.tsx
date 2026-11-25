import { Activity, ChevronLeft, ChevronRight, CircleAlert, Download, Info, RefreshCw, RotateCcw } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RetakeControl } from "@/app/data-tes/monitoring/retake-control";
import { RetakeRecovery } from "@/app/data-tes/monitoring/retake-recovery";
import { FinalGradeRecovery } from "@/app/data-tes/monitoring/final-grade-recovery";
import { FinalGradePanel } from "@/app/data-tes/monitoring/final-grade-panel";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { gradeExamCounts } from "@/lib/exam-grading.mjs";
import { monitoringSearchParams, parseMonitoringFilters, type MonitoringFilters } from "@/lib/monitoring-filter.mjs";
import { MONITOR_MAX_EXPORT, MONITOR_PAGE_SIZE, MonitoringPermissionDenied, MonitoringSessionExpired, withMonitoringSnapshot, type MonitoringData } from "./monitoring-data";
import { durationLabel, kindLabels, statusLabels } from "./monitoring-workbook";
import { SearchableTest } from "./searchable-test";

export const metadata = { title: "Hasil / Monitoring Tes — NusaCBT", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
function paramsOf(input: Search) { const result = new URLSearchParams(); for (const [key,value] of Object.entries(input)) if (Array.isArray(value)) value.forEach((v) => result.append(key,v)); else if (value !== undefined) result.append(key,value); return result; }
function pageUrl(f: MonitoringFilters, page = 1, finalPage = 1) { const p = monitoringSearchParams(f,page,finalPage).toString(); return `/data-tes/monitoring${p ? `?${p}` : ""}`; }
const field = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm";

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { admin, allowed } = await requireAdminAccess("monitoring.view", "grading_overrides.manage");
  if (!allowed) return <AccessDenied section="Data tes" title="Hasil / Monitoring Tes" />;
  const canViewMonitoring = adminHasPermission(admin, "monitoring.view");
  const canOverrideGrades = adminHasPermission(admin, "grading_overrides.manage");
  const canManageControls = adminHasPermission(admin, "exam_controls.manage");
  const rawSearch = await searchParams;
  const searchList = paramsOf(rawSearch);
  const parsed = parseMonitoringFilters(searchList);
  if (!parsed.ok) return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Hasil / Monitoring Tes</h1><Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Filter tidak valid</AlertTitle><AlertDescription>{parsed.error} <Link href="/data-tes/monitoring" className="underline">Atur ulang filter</Link>.</AlertDescription></Alert></div>;
  const applySmartDefaults = Object.keys(rawSearch).length === 0 && !parsed.filters.showAll;
  let data: MonitoringData;
  try {
    data = await withMonitoringSnapshot(
      parsed.filters,
      parsed.page,
      parsed.finalPage,
      false,
      (result) => result,
      { applySmartDefaults },
    );
  } catch (error) {
    if (error instanceof MonitoringSessionExpired) redirect("/login");
    if (error instanceof MonitoringPermissionDenied) return <AccessDenied section="Data tes" title="Hasil / Monitoring Tes" />;
    return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Hasil / Monitoring Tes</h1><Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Monitoring belum dapat dimuat</AlertTitle><AlertDescription>Periksa PostgreSQL dan migrasi terbaru, lalu muat ulang.</AlertDescription></Alert></div>;
  }
  const f = data.effectiveFilters;
  const opts = data.options!; const selectedTest = opts.tests.find((t) => t.id === f.testId);
  const unknownYear = f.yearId && !opts.years.some((y) => y.id === f.yearId);
  const unknownClass = f.className && !opts.classes.includes(f.className);
  const exportUrl = `/data-tes/monitoring/unduh?${monitoringSearchParams({ ...f, showAll: false })}`;
  const formKey = JSON.stringify([f.yearId, f.testId, f.className, f.kind, f.status, f.from, f.to, f.zone, f.order, f.showAll]);
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><Activity className="size-5" /></span><div><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-1 text-[26px] font-bold tracking-tight sm:text-[30px]">Hasil / Monitoring Tes</h1><p className="mt-2 text-[13px] text-muted-foreground">Pantau peserta terdaftar, pengerjaan, dan nilai.</p></div></div><Button asChild variant="outline" className="rounded-xl"><Link href={pageUrl(f,data.page,parsed.finalPage)} prefetch={false}><RefreshCw className="size-4" /> Muat ulang</Link></Button></div>
    {canOverrideGrades && <><RetakeRecovery /><FinalGradeRecovery /></>}
    <Card className="mb-5 gap-0 rounded-[20px] p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">Filter monitoring</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Rentang tanggal berdasarkan waktu mulai <strong>jadwal pelaksanaan</strong> dalam zona yang dipilih, termasuk peserta yang belum mulai. Pilih tes dari saran pencarian; kosongkan untuk semua tes.</p>
        </div>
        {data.defaultApplied && (
          <Badge variant="secondary" className="rounded-full text-[10px]">
            Filter otomatis: {selectedTest ? `${selectedTest.name}` : "Tahun ajaran aktif"}
          </Badge>
        )}
      </div>
      <form key={formKey} action="/data-tes/monitoring" className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SearchableTest key={f.testId ?? "all"} options={opts.tests} selectedId={f.testId} />
        <div><label htmlFor="monitor-year" className="mb-1 block text-xs font-semibold">Tahun ajaran</label><select id="monitor-year" name="tahun" defaultValue={f.yearId ?? ""} className={field}><option value="">Semua tahun</option>{unknownYear && <option value={f.yearId!}>Tahun tidak ditemukan</option>}{opts.years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></div>
        <div><label htmlFor="monitor-class" className="mb-1 block text-xs font-semibold">Kelas / rombel</label><select id="monitor-class" name="kelas" defaultValue={f.className ?? ""} className={field}><option value="">Semua kelas</option>{unknownClass && <option value={f.className!}>{f.className}</option>}{opts.classes.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div><label htmlFor="monitor-kind" className="mb-1 block text-xs font-semibold">Kategori tes</label><select id="monitor-kind" name="kategori" defaultValue={f.kind ?? ""} className={field}><option value="">Semua kategori</option><option value="regular">Reguler</option><option value="makeup">Susulan</option><option value="remedial">Remidi</option></select></div>
        <div><label htmlFor="monitor-status" className="mb-1 block text-xs font-semibold">Status peserta</label><select id="monitor-status" name="status" defaultValue={f.status ?? ""} className={field}><option value="">Semua status</option>{Object.entries(statusLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label htmlFor="monitor-from" className="mb-1 block text-xs font-semibold">Tanggal jadwal dari</label><input id="monitor-from" name="dari" type="date" min="2000-01-01" max="2100-12-31" defaultValue={f.from ?? ""} className={field} /></div>
        <div><label htmlFor="monitor-to" className="mb-1 block text-xs font-semibold">Tanggal jadwal sampai</label><input id="monitor-to" name="sampai" type="date" min="2000-01-01" max="2100-12-31" defaultValue={f.to ?? ""} className={field} /></div>
        <div><label htmlFor="monitor-zone" className="mb-1 block text-xs font-semibold">Zona waktu</label><select id="monitor-zone" name="zona" defaultValue={f.zone} className={field}><option value="WIB">WIB</option><option value="WITA">WITA</option><option value="WIT">WIT</option></select></div>
        <div><label htmlFor="monitor-order" className="mb-1 block text-xs font-semibold">Urutkan</label><select id="monitor-order" name="urut" defaultValue={f.order} className={field}><option value="time_desc">Waktu terbaru</option><option value="time_asc">Waktu terlama</option><option value="score_desc">Nilai tertinggi</option><option value="score_asc">Nilai terendah</option><option value="student_asc">Nama peserta A–Z</option><option value="student_desc">Nama peserta Z–A</option><option value="test_asc">Nama tes A–Z</option><option value="test_desc">Nama tes Z–A</option></select></div>
        <div className="flex flex-wrap gap-2 lg:col-span-3">
          <Button type="submit">Terapkan</Button>
          <Button asChild variant="outline"><Link href="/data-tes/monitoring?semua=1" prefetch={false}>Tampilkan semua</Link></Button>
          <Button asChild variant="ghost"><Link href="/data-tes/monitoring" prefetch={false}><RotateCcw className="size-4" /> Reset</Link></Button>
        </div>
      </form></Card>
    <Card className="mb-5 gap-0 overflow-hidden rounded-[20px] py-0"><div className="flex flex-wrap items-start justify-between gap-3 border-b p-5"><div><h2 className="font-bold">Daftar hasil <Badge variant="secondary">{data.total}</Badge></h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Satu baris per pengerjaan; peserta terdaftar tanpa pengerjaan muncul sebagai Belum mulai. Draf ditandai. Lama untuk pengerjaan aktif dihitung saat halaman dimuat.</p></div>{canViewMonitoring && (data.total > 0 && data.total <= MONITOR_MAX_EXPORT ? <Button asChild size="sm"><a href={exportUrl}><Download className="size-4" /> Ekspor .xlsx</a></Button> : <Button disabled size="sm"><Download className="size-4" /> Ekspor .xlsx</Button>)}</div>
      {data.total > MONITOR_MAX_EXPORT && <p role="status" className="border-b p-4 text-xs text-amber-700 dark:text-amber-300">Sempitkan filter untuk ekspor maksimal {MONITOR_MAX_EXPORT.toLocaleString("id-ID")} baris.</p>}
      {!data.rows.length ? <p className="p-10 text-center text-sm text-muted-foreground">Tidak ada peserta yang cocok dengan filter.</p> : <div className="overflow-x-auto" data-testid="monitor-table-container"><table className="w-full min-w-[850px] table-fixed text-left text-[12px]"><colgroup><col className="w-[4%]" /><col className="w-[14%]" /><col className="w-[9%]" /><col className="w-[18%]" /><col className="w-[11%]" /><col className="w-[18%]" /><col className="w-[8%]" /><col className="w-[18%]" /></colgroup><thead className="bg-muted/40 text-[11px] text-muted-foreground"><tr><th scope="col" className="p-2">No</th><th scope="col" className="p-2">Waktu mulai</th><th scope="col" className="p-2">Lama</th><th scope="col" className="p-2">Nama tes</th><th scope="col" className="p-2">Kelas / rombel</th><th scope="col" className="p-2">Nama peserta</th><th scope="col" className="p-2">Nilai</th><th scope="col" className="p-2">Status</th></tr></thead><tbody>{data.rows.map((r,index) => { const grade = r.correct !== null && r.questionCount ? gradeExamCounts(r.correct,r.questionCount) : null;
        return <tr key={`${r.runId}:${r.studentId}:${r.id ?? "not-started"}`} data-testid="monitor-row" className="border-t align-top"><td className="p-2 tabular-nums">{(data.page-1)*MONITOR_PAGE_SIZE+index+1}</td><td className="break-words p-2 tabular-nums">{r.started ?? "—"}{r.started && <span className="block text-[10px] text-muted-foreground">{r.zone}</span>}</td><td className="break-words p-2 tabular-nums">{durationLabel(r.elapsedSeconds)}{r.status === "working" && <span className="block text-[10px] text-muted-foreground">berjalan</span>}</td><td className="break-words p-2"><strong>{r.testName}</strong><span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{kindLabels[r.kind]} · {r.label}<br />{r.period}{!r.published && " · Draf"}{r.attemptNumber !== null && ` · Pengerjaan ke-${r.attemptNumber}`}</span></td><td className="break-words p-2">{r.className}</td><td className="break-words p-2"><strong>{r.student}</strong><span className="mt-1 block text-[10px] text-muted-foreground">{r.number ?? "Belum beridentitas"}</span></td><td className="p-2 font-bold tabular-nums">{grade?.ok ? grade.display : "—"}</td><td className="break-words p-2"><Badge variant={r.status === "working" ? "default" : "secondary"} className="whitespace-normal">{statusLabels[r.status]}</Badge>
          {r.id && <details open className="mt-2 text-[10px] leading-4"><summary className="cursor-pointer font-semibold text-primary">Izin mengulang</summary><p className="mt-1 text-muted-foreground">{r.permissionStatus ? `Izin ${r.permissionStatus === "pending" ? "tersedia" : r.permissionStatus === "consumed" ? "digunakan" : r.permissionStatus === "revoked" ? "dicabut" : "kedaluwarsa"}` : "Belum ada izin"}{r.grantedAt && ` · ${r.grantedAt} ${r.zone}`}{r.grantedBy && ` · ${r.grantedBy}`}{r.actionAt && ` · ${r.permissionStatus === "revoked" ? `Dicabut ${r.revokedBy ?? "admin dihapus"}` : "Digunakan"} ${r.actionAt} ${r.zone}`}</p>
            {canOverrideGrades && !r.finalized && r.latest && r.completed && r.withinWindow && (r.permissionStatus === null || r.permissionStatus === "revoked" || r.permissionStatus === "pending") && <div className="mt-2"><RetakeControl attemptId={r.id} expectedPermissionId={r.permissionId} expectedFinalRevision={r.finalRevision} mode={r.permissionStatus === "pending" ? "revoke" : "grant"} student={r.student} number={r.number ?? "—"} className={r.className} period={r.period} testName={r.testName} label={r.label} attemptNumber={r.attemptNumber ?? 1} deadline={r.deadline ?? "—"} zone={r.zone} /></div>}</details>}</td></tr>;
      })}</tbody></table></div>}
      {data.pages > 1 && <nav aria-label="Halaman hasil" className="flex flex-wrap items-center justify-between gap-2 border-t p-5 text-xs"><span>Halaman {data.page} dari {data.pages}</span><div className="flex gap-2">{data.page > 1 && <Button asChild size="sm" variant="outline"><Link href={pageUrl(f,data.page-1,parsed.finalPage)}><ChevronLeft className="size-4" /> Sebelumnya</Link></Button>}{data.page < data.pages && <Button asChild size="sm" variant="outline"><Link href={pageUrl(f,data.page+1,parsed.finalPage)}>Berikutnya <ChevronRight className="size-4" /></Link></Button>}</div></nav>}
    </Card>
    <Alert className="mb-5"><Info className="size-4" /><AlertTitle>Nilai pengerjaan dan nilai akhir</AlertTitle><AlertDescription>Nilai pada tabel adalah nilai tiap pengerjaan. Pilih satu tes untuk mengatur nilai akhir dan izin ulang. Panel nilai akhir tetap memakai seluruh pengerjaan selesai semua kategori, tidak dibatasi filter monitoring.{canManageControls && <> <Link href="/data-tes/pengaturan-pengerjaan" className="font-semibold underline">Buka Pengaturan Pengerjaan</Link>.</>}</AlertDescription></Alert>
    {selectedTest && data.final && <FinalGradePanel test={selectedTest} data={data.final} attemptPage={data.page} filterQuery={monitoringSearchParams({ ...f, showAll: false }).toString()} canOverrideGrades={canOverrideGrades} />}
  </div>;
}
