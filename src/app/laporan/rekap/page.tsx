import { BarChart3, ChevronLeft, ChevronRight, CircleAlert, Download, Info, RotateCcw } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin-auth";
import { formatFinalGrade } from "@/lib/exam-final-grade.mjs";
import { parseReportFilters, reportSearchParams, type ReportFilters } from "@/lib/report-filter.mjs";
import { ReportSessionExpired, ReportSizeExceeded, REPORT_MAX_ATTEMPTS, REPORT_MAX_EXPORT_PAIRS, withReportSnapshot, type ReportData } from "./report-data";

export const metadata = { title: "Rekap Hasil Tes — NusaCBT", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
function urlParams(input: Search) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.append(key, value);
  }
  return params;
}
function pageUrl(filters: ReportFilters, page: number) { return `/laporan/rekap?${reportSearchParams(filters, page)}`; }
const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm";
const inputClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm";
const kinds = { regular: "Reguler", makeup: "Susulan", remedial: "Remidi" } as const;

export default async function ReportPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const parsed = parseReportFilters(urlParams(await searchParams));
  if (!parsed.ok) return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Rekap Hasil Tes</h1>
    <Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Filter tidak valid</AlertTitle>
      <AlertDescription>{parsed.error} <Link className="underline" href="/laporan/rekap">Atur ulang filter</Link>.</AlertDescription></Alert></div>;
  const { filters } = parsed;
  let data: ReportData;
  try { data = await withReportSnapshot(filters, parsed.page, false, (result) => result); }
  catch (error) {
    if (error instanceof ReportSessionExpired) redirect("/login");
    return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Rekap Hasil Tes</h1>
      <Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Laporan belum dapat dimuat</AlertTitle>
        <AlertDescription>{error instanceof ReportSizeExceeded ? error.message : "Periksa PostgreSQL dan migrasi sampai 023, lalu muat ulang."} <Link className="underline" href="/laporan/rekap">Atur ulang filter</Link>.</AlertDescription></Alert></div>;
  }
  const options = data.options!;
  const unknownPeriod = filters.periodId && !options.periods.some((item) => item.id === filters.periodId);
  const unknownTest = filters.testId && !options.tests.some((item) => item.id === filters.testId);
  const unknownClass = filters.className && !options.classes.includes(filters.className);
  const exportUrl = `/laporan/rekap/unduh?${reportSearchParams(filters)}`;
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><BarChart3 className="size-5" /></span>
        <div><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Laporan</p><h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Rekap Hasil Tes</h1><p className="mt-2 text-[13px] leading-6 text-muted-foreground">Satu baris per tes dan peserta dengan rincian pengerjaan selesai.</p></div></div>
      {data.total > 0 && data.total <= REPORT_MAX_EXPORT_PAIRS && !data.sizeWarning ? <Button asChild className="rounded-xl"><a href={exportUrl}><Download className="size-4" /> Unduh Excel</a></Button>
        : <Button disabled className="rounded-xl"><Download className="size-4" /> Unduh Excel</Button>}
    </div>
    <Alert className="mb-5 rounded-2xl"><Info className="size-4" /><AlertTitle>Bagaimana laporan disaring?</AlertTitle>
      <AlertDescription className="text-xs leading-5">Pasangan tes/peserta muncul jika ada <strong>satu pengerjaan selesai yang cocok dengan seluruh filter</strong>. Nilai akhir dan rincian tetap memakai <strong>semua</strong> pengerjaan selesai, termasuk yang di luar filter. Pengerjaan belum selesai tidak dihitung; peserta yang belum memiliki pengerjaan selesai tidak muncul. Nilai sementara belum ditetapkan. Laporan admin dapat memuat nilai yang belum dibagikan kepada peserta; simpan file Excel secara aman.</AlertDescription></Alert>
    <Card className="mb-5 gap-0 rounded-[20px] p-5">
      <div><h2 className="font-bold">Filter laporan</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Kelas adalah nama yang tersimpan saat pengerjaan dimulai. Pencarian siswa mencocokkan nama atau nomor peserta saat itu, atau NISN saat ini. Rentang berdasarkan waktu selesai, dalam zona yang dipilih; batas akhir mencakup satu menit yang dipilih.</p></div>
      <form action="/laporan/rekap" className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><label htmlFor="report-period" className="mb-1 block text-xs font-semibold">Periode</label><select id="report-period" name="periode" defaultValue={filters.periodId ?? ""} className={selectClass}><option value="">Semua periode</option>{unknownPeriod && <option value={filters.periodId!}>Periode tidak ditemukan</option>}{options.periods.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></div>
        <div><label htmlFor="report-test" className="mb-1 block text-xs font-semibold">Tes</label><select id="report-test" name="tes" defaultValue={filters.testId ?? ""} className={selectClass}><option value="">Semua tes</option>{unknownTest && <option value={filters.testId!}>Tes tidak ditemukan</option>}{options.tests.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.period}</option>)}</select></div>
        <div><label htmlFor="report-class" className="mb-1 block text-xs font-semibold">Kelas saat mulai</label><select id="report-class" name="kelas" defaultValue={filters.className ?? ""} className={selectClass}><option value="">Semua kelas</option>{unknownClass && <option value={filters.className!}>{filters.className}</option>}{options.classes.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div><label htmlFor="report-student" className="mb-1 block text-xs font-semibold">Siswa / nomor / NISN</label><input id="report-student" name="siswa" defaultValue={filters.student ?? ""} maxLength={100} className={inputClass} placeholder="Cari siswa" /></div>
        <div><label htmlFor="report-from" className="mb-1 block text-xs font-semibold">Selesai dari</label><input id="report-from" name="mulai" type="datetime-local" min="2000-01-01T00:00" max="2100-12-31T23:59" step={60} defaultValue={filters.fromLocal ?? ""} className={inputClass} /></div>
        <div><label htmlFor="report-to" className="mb-1 block text-xs font-semibold">Selesai sampai</label><input id="report-to" name="sampai" type="datetime-local" min="2000-01-01T00:00" max="2100-12-31T23:59" step={60} defaultValue={filters.toLocal ?? ""} className={inputClass} /></div>
        <div><label htmlFor="report-zone" className="mb-1 block text-xs font-semibold">Zona waktu laporan</label><select id="report-zone" name="zona" defaultValue={filters.zone} className={selectClass}><option value="WIB">WIB (UTC+7)</option><option value="WITA">WITA (UTC+8)</option><option value="WIT">WIT (UTC+9)</option></select></div>
        <div className="flex flex-wrap gap-2"><Button type="submit" className="rounded-lg">Terapkan</Button><Button asChild variant="outline" className="rounded-lg"><Link href="/laporan/rekap"><RotateCcw className="size-4" /> Reset</Link></Button></div>
      </form>
    </Card>
    <Card className="gap-0 overflow-hidden rounded-[20px] py-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b p-5"><div><h2 className="font-bold">Hasil rekap <Badge variant="secondary">{data.total}</Badge></h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Nama, nomor, kelas, dan nama tes pada baris adalah snapshot pengerjaan cocok terbaru; NISN dan nama periode adalah data saat ini. Waktu ditampilkan dalam {data.zone}.</p></div>
        <p className="text-xs text-muted-foreground">Excel mencakup semua halaman; maksimal {REPORT_MAX_EXPORT_PAIRS.toLocaleString("id-ID")} pasangan dan {REPORT_MAX_ATTEMPTS.toLocaleString("id-ID")} rincian per unduhan.</p></div>
      {data.total > REPORT_MAX_EXPORT_PAIRS && <p role="status" className="border-b p-4 text-sm text-amber-700 dark:text-amber-300">Sempitkan filter agar jumlah hasil dapat diunduh.</p>}
      {data.sizeWarning ? <p role="alert" className="p-5 text-sm text-destructive">{data.sizeWarning} Hasil tidak ditampilkan sebagian.</p> : data.rows.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">Tidak ada pengerjaan selesai yang cocok dengan filter.</div> :
        <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th scope="col" className="p-4">Peserta</th><th scope="col" className="p-4">Tes / periode</th><th scope="col" className="p-4">Selesai cocok terakhir</th><th scope="col" className="p-4">Metode</th><th scope="col" className="p-4">Nilai akhir</th><th scope="col" className="p-4">Pengerjaan</th></tr></thead>
          <tbody>{data.rows.map((row) => <Fragment key={`${row.testId}:${row.identityId}`}><tr className="border-t align-top" data-testid="report-pair-row">
            <td className="p-4"><p className="font-semibold">{row.student}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{row.number} · {row.className}<br />NISN {row.nisn}</p></td>
            <td className="p-4"><p className="font-semibold">{row.testName}</p><p className="mt-1 text-xs text-muted-foreground">{row.period}</p></td>
            <td className="p-4 text-xs tabular-nums">{row.matchedAt} {data.zone}</td><td className="p-4">{row.method === "highest" ? "Tertinggi" : "Rata-rata"}</td>
            <td className="p-4"><p className="font-bold tabular-nums">{formatFinalGrade(row.score)}</p><Badge variant={row.finalized ? "default" : "secondary"} className="mt-1">{row.finalized ? "Ditetapkan" : "Sementara"}</Badge>{row.finalizedAt && <p className="mt-1 text-xs text-muted-foreground">{row.finalizedAt} {data.zone}</p>}</td>
            <td className="p-4 text-xs leading-5">{row.attempts.length} selesai<br />{row.unfinished} belum selesai</td>
          </tr><tr className="border-t bg-muted/10"><td colSpan={6} className="px-4 py-3"><details><summary className="w-fit cursor-pointer text-sm font-semibold text-primary">Rincian {row.attempts.length} pengerjaan selesai</summary>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Semua pengerjaan selesai penyumbang ditampilkan, walaupun tidak cocok filter. Nilai dihitung dari benar/jumlah soal sebelum pembulatan agregat.</p>
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="text-muted-foreground"><tr><th scope="col" className="p-2">Pelaksanaan</th><th scope="col" className="p-2">Peserta / kelas saat itu</th><th scope="col" className="p-2">Mulai / selesai ({data.zone})</th><th scope="col" className="p-2">Hasil</th><th scope="col" className="p-2">Filter</th></tr></thead><tbody>{row.attempts.map((a) => <tr key={a.id} className="border-t" data-testid="report-attempt-row"><td className="p-2">{kinds[a.kind]} · {a.label}<br />Pengerjaan ke-{a.attemptNumber}</td><td className="p-2">{a.student}<br />{a.number} · {a.className}</td><td className="p-2 tabular-nums">{a.started}<br />{a.completed}</td><td className="p-2">{a.correct}/{a.questions} benar · <strong>{formatFinalGrade(a.score)}</strong><br />{a.reason === "submitted" ? "Dikumpulkan" : "Waktu habis"}</td><td className="p-2">{a.matches ? "Cocok" : "Di luar filter"}</td></tr>)}</tbody></table></div>
          </details></td></tr></Fragment>)}</tbody></table></div>}
      {data.pages > 1 && <nav aria-label="Halaman rekap" className="flex flex-wrap items-center justify-between gap-2 border-t p-5 text-xs"><span>Halaman {data.page} dari {data.pages}</span><div className="flex gap-2">{data.page > 1 && <Button asChild size="sm" variant="outline"><Link href={pageUrl(filters, data.page - 1)} prefetch={false}><ChevronLeft className="size-4" /> Sebelumnya</Link></Button>}{data.page < data.pages && <Button asChild size="sm" variant="outline"><Link href={pageUrl(filters, data.page + 1)} prefetch={false}>Berikutnya <ChevronRight className="size-4" /></Link></Button>}</div></nav>}
    </Card>
  </div>;
}
