import { BarChart3, ChevronLeft, ChevronRight, CircleAlert, Download, Info, RotateCcw } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAdminAccess } from "@/lib/admin-auth";
import { matrixSearchParams, parseMatrixFilters, type MatrixFilters } from "@/lib/matrix-report-filter.mjs";
import { MATRIX_MAX_ATTEMPTS, MATRIX_MAX_STUDENTS, MATRIX_MAX_TESTS, MATRIX_PAGE_SIZE, MatrixPermissionDenied, MatrixSessionExpired, withMatrixSnapshot, type MatrixData } from "./matrix-data";
import { MatrixKindFilter } from "./matrix-kind-filter";
import { MatrixReportTable } from "./matrix-report-table";
import { MatrixTestFilter } from "./matrix-test-filter";

export const metadata = { title:"Rekap Hasil Tes",robots:{index:false,follow:false} };
export const dynamic = "force-dynamic";
type Search = Record<string,string|string[]|undefined>;
function paramsOf(input:Search) { const p=new URLSearchParams(); for(const [k,v] of Object.entries(input)) if(Array.isArray(v))v.forEach((x)=>p.append(k,x));else if(v!==undefined)p.append(k,v);return p; }
function pageUrl(f:MatrixFilters,page:number) { const p=matrixSearchParams(f,page).toString(); return `/laporan/rekap${p ? `?${p}` : ""}`; }
const field="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm";

export default async function ReportPage({searchParams}:{searchParams:Promise<Search>}) {
  const { allowed } = await requireAdminAccess("reports.view");
  if (!allowed) return <AccessDenied section="Laporan" title="Rekap Hasil Tes" />;
  const rawSearch = await searchParams;
  const searchList = paramsOf(rawSearch);
  const parsed=parseMatrixFilters(searchList);
  if(!parsed.ok) return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Rekap Hasil Tes</h1><Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Filter tidak valid</AlertTitle><AlertDescription>{parsed.error} <Link href="/laporan/rekap" className="underline">Atur ulang filter</Link>.</AlertDescription></Alert></div>;
  const applySmartDefaults = Object.keys(rawSearch).length === 0 && !parsed.filters.showAll;
  let data:MatrixData;
  try { data=await withMatrixSnapshot(parsed.filters,parsed.page,false,(result)=>result,{applySmartDefaults, zoneExplicit: searchList.has("zona")}); }
  catch(error) {if(error instanceof MatrixSessionExpired)redirect("/login");if(error instanceof MatrixPermissionDenied)return <AccessDenied section="Laporan" title="Rekap Hasil Tes" />;return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Rekap Hasil Tes</h1><Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Rekap belum dapat dimuat</AlertTitle><AlertDescription>Periksa PostgreSQL dan migrasi terbaru.</AlertDescription></Alert></div>;}
  const f = data.effectiveFilters;
  const opts=data.options!; const unknownYear=f.yearId && !opts.years.some((x)=>x.id===f.yearId),unknownPeriod=f.periodId && !opts.periods.some((x)=>x.id===f.periodId),unknownTest=f.testId && !opts.tests.some((x)=>x.id===f.testId),unknownClass=f.className && !opts.classes.includes(f.className);
  const selectedYear = opts.years.find((x) => x.id === f.yearId);
  const selectedPeriod = opts.periods.find((x) => x.id === f.periodId);
  const exportUrl=`/laporan/rekap/unduh?${matrixSearchParams({ ...f, showAll: false })}`;
  const formKey = JSON.stringify([f.yearId, f.periodId, f.testId, f.className, f.student, f.kind, f.merge, f.from, f.to, f.zone, f.showAll]);
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9"><div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><BarChart3 className="size-5" /></span><div><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Laporan</p><h1 className="mt-1 text-[26px] font-bold tracking-tight sm:text-[30px]">Rekap Hasil Tes</h1><p className="mt-2 text-[13px] text-muted-foreground">Siswa sebagai baris, tes sebagai kolom.</p></div></div>{data.total>0 && !data.warning ? <Button asChild><a href={exportUrl}><Download className="size-4" /> Unduh Excel</a></Button> : <Button disabled><Download className="size-4" /> Unduh Excel</Button>}</div>
    <Alert className="mb-5"><Info className="size-4" /><AlertTitle>Cara membaca rekap</AlertTitle><AlertDescription className="text-xs leading-5">Hanya pengerjaan selesai yang cocok seluruh filter dihitung dengan metode tes (tertinggi atau rata-rata). Ini dapat berbeda dari nilai akhir yang ditetapkan dan tidak mengubahnya. Saat gabung, nilai Susulan berwarna biru; jika Reguler dan Susulan sama-sama ada untuk siswa/tes, sel bertanda <strong>Periksa</strong> dan tidak dihitung. Rata-rata hanya dari nilai tes yang tersedia, bukan nol untuk sel kosong atau bentrok.</AlertDescription></Alert>
    <Card className="mb-5 gap-0 rounded-[20px] p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">Filter rekap</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Rentang memakai tanggal <strong>selesai pengerjaan</strong> pada zona yang dipilih, termasuk seluruh tanggal akhir. Kelas dan nama adalah snapshot saat pengerjaan dimulai.</p>
        </div>
        {data.defaultApplied && (
          <Badge variant="secondary" className="rounded-full text-[10px]">
            Filter otomatis: {[selectedYear?.name, selectedPeriod?.name].filter(Boolean).join(" · ") || "Tahun ajaran aktif"}
          </Badge>
        )}
      </div>
      <form key={formKey} action="/laporan/rekap" className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {searchList.has("zona") && <input type="hidden" name="zona" value={f.zone} />}
      <div><label htmlFor="matrix-year" className="mb-1 block text-xs font-semibold">Tahun ajaran</label><select id="matrix-year" name="tahun" defaultValue={f.yearId??""} className={field}><option value="">Semua tahun</option>{unknownYear && <option value={f.yearId!}>Tahun tidak ditemukan</option>}{opts.years.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
      <div><label htmlFor="matrix-period" className="mb-1 block text-xs font-semibold">Periode</label><select id="matrix-period" name="periode" defaultValue={f.periodId??""} className={field}><option value="">Semua periode</option>{unknownPeriod && <option value={f.periodId!}>Periode tidak ditemukan</option>}{opts.periods.map((x)=><option key={x.id} value={x.id}>{x.name}{x.year ? ` · ${x.year}` : " · belum dipetakan"}</option>)}</select></div>
      <div><label htmlFor="matrix-class" className="mb-1 block text-xs font-semibold">Kelas / rombel</label><select id="matrix-class" name="kelas" defaultValue={f.className??""} className={field}><option value="">Semua kelas</option>{unknownClass && <option value={f.className!}>{f.className}</option>}{opts.classes.map((x)=><option key={x} value={x}>{x}</option>)}</select></div>
      <MatrixTestFilter key={f.testId ?? "all"} tests={opts.tests} initialTestId={f.testId} unknownTest={Boolean(unknownTest)} />
      <MatrixKindFilter key={`${f.kind}:${f.merge}`} initialKind={f.kind} initialMerge={f.merge} />
      <div><label htmlFor="matrix-from" className="mb-1 block text-xs font-semibold">Selesai dari tanggal</label><input id="matrix-from" name="dari" type="date" min="2000-01-01" max="2100-12-31" defaultValue={f.from??""} className={field} /></div>
      <div><label htmlFor="matrix-to" className="mb-1 block text-xs font-semibold">Selesai sampai tanggal</label><input id="matrix-to" name="sampai" type="date" min="2000-01-01" max="2100-12-31" defaultValue={f.to??""} className={field} /></div>
      <div><span className="mb-1 block text-xs font-semibold">Zona waktu</span><div className="flex h-10 items-center rounded-lg border border-input bg-muted/40 px-3 text-sm font-medium text-muted-foreground">{f.zone} · Pengaturan Aplikasi</div></div>
      <div><label htmlFor="matrix-student" className="mb-1 block text-xs font-semibold">Siswa / nomor / NISN</label><input id="matrix-student" name="siswa" maxLength={100} defaultValue={f.student??""} placeholder="Cari siswa" className={field} /></div>
      <div className="flex flex-wrap gap-2 lg:col-span-2">
        <Button type="submit">Terapkan</Button>
        <Button asChild variant="outline"><Link href="/laporan/rekap?semua=1" prefetch={false}>Tampilkan semua</Link></Button>
        <Button asChild variant="ghost"><Link href="/laporan/rekap" prefetch={false}><RotateCcw className="size-4" /> Reset</Link></Button>
      </div>
    </form></Card>
    <Card className="gap-0 overflow-hidden rounded-[20px] py-0"><div className="flex flex-wrap items-end justify-between gap-3 border-b p-5"><div><h2 className="font-bold">Matriks hasil <Badge variant="secondary">{data.total} siswa</Badge></h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{data.columns.length} tes · {data.attempts} pengerjaan selesai cocok. Nama dan kelas siswa memakai snapshot cocok terbaru.</p></div><p className="text-xs text-muted-foreground">Maksimal {MATRIX_MAX_STUDENTS} siswa, {MATRIX_MAX_TESTS} tes, dan {MATRIX_MAX_ATTEMPTS.toLocaleString("id-ID")} pengerjaan cocok.</p></div>
      {data.warning ? <p role="alert" className="p-5 text-sm text-destructive">{data.warning} Hasil tidak ditampilkan sebagian.</p> : !data.rows.length ? <p className="p-10 text-center text-sm text-muted-foreground">Tidak ada pengerjaan selesai yang cocok dengan filter.</p> : <MatrixReportTable columns={data.columns} rows={data.rows} page={data.page} pageSize={MATRIX_PAGE_SIZE} />}
      {data.pages>1 && <nav aria-label="Halaman rekap" className="flex flex-wrap items-center justify-between gap-2 border-t p-5 text-xs"><span>Halaman {data.page} dari {data.pages}</span><div className="flex gap-2">{data.page>1 && <Button asChild size="sm" variant="outline"><Link href={pageUrl(f,data.page-1)}><ChevronLeft className="size-4" /> Sebelumnya</Link></Button>}{data.page<data.pages && <Button asChild size="sm" variant="outline"><Link href={pageUrl(f,data.page+1)}>Berikutnya <ChevronRight className="size-4" /></Link></Button>}</div></nav>}
    </Card>
  </div>;
}
