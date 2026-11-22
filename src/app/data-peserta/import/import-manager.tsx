"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowDownToLine, CheckCircle2, CircleAlert, FileSpreadsheet, Info, ListChecks, UploadCloud } from "lucide-react";

import { previewStudents, saveImportedStudents } from "@/app/data-peserta/import/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ImportCounts, ImportPreview, ImportStatus } from "@/lib/student-import-types";
import type { PlacementPeriod } from "@/lib/student-types";

const PAGE_SIZE = 25;
const MAX_FILE_SIZE = 512 * 1024;
const statuses: Record<ImportStatus, string> = {
  "siswa-baru": "Siswa baru",
  "penempatan-baru": "Penempatan baru",
  "sudah-sesuai": "Sudah sesuai",
  "masalah": "Perlu diperbaiki",
};

function Summary({ counts }: { counts: ImportCounts }) {
  const tiles = [
    { label: "Baris diperiksa", value: counts.rows },
    { label: "Siswa baru", value: counts.newStudents },
    { label: "Penempatan baru", value: counts.newPlacements },
    { label: "Sudah sesuai", value: counts.unchanged },
    { label: "Perlu diperbaiki", value: counts.problems },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map((tile) => <div key={tile.label} className="min-w-0 rounded-xl border border-border bg-muted/30 px-3 py-2.5"><p className="text-[10px] font-semibold text-muted-foreground">{tile.label}</p><p className="mt-1 text-lg font-bold tabular-nums">{tile.value}</p></div>)}
    </div>
  );
}

export function ImportManager({ periods, classCount }: { periods: PlacementPeriod[]; classCount: number }) {
  const [periodId, setPeriodId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [completed, setCompleted] = useState<ImportCounts | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [page, setPage] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const ready = periods.length > 0 && classCount > 0;
  const pages = preview ? Math.ceil(preview.rows.length / PAGE_SIZE) : 0;
  const visibleRows = preview?.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];

  function clearResult() {
    setPreview(null);
    setCompleted(null);
    setError("");
    setPage(0);
  }

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    clearResult();
    if (!periodId) return setError("Pilih tahun ajaran terlebih dahulu.");
    if (!file || !file.name.toLowerCase().endsWith(".xlsx")) return setError("Pilih file Excel .xlsx.");
    if (file.size === 0 || file.size > MAX_FILE_SIZE) return setError("Ukuran file harus lebih dari 0 dan maksimal 512 KB.");
    const data = new FormData();
    data.set("periodId", periodId);
    data.set("file", file);
    setBusy("preview");
    try {
      const result = await previewStudents(data);
      if (!result.ok) return setError(result.error);
      setPreview(result.preview);
    } catch {
      setError("Pratinjau belum dapat dibuat. Periksa sesi dan koneksi, lalu coba lagi.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    if (busy || !preview?.token || !file || !periodId) return;
    const data = new FormData();
    data.set("periodId", periodId);
    data.set("file", file);
    data.set("previewToken", preview.token);
    setError("");
    setBusy("save");
    try {
      const result = await saveImportedStudents(data);
      setConfirmOpen(false);
      if (!result.ok) {
        setPreview(null);
        return setError(result.error);
      }
      setCompleted(result.counts);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch {
      setConfirmOpen(false);
      setPreview(null);
      setError("Hasil penyimpanan belum dapat dipastikan. Periksa Data Siswa dan sesi, lalu buat pratinjau ulang sebelum mencoba lagi.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-6xl space-y-5">
      <Alert className="rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200">
        <Info className="size-4 text-[#727fc8] dark:text-indigo-300" />
        <AlertTitle className="text-[12px] font-bold">Impor aman dengan pratinjau</AlertTitle>
        <AlertDescription className="mt-0.5 text-[12px] leading-5 text-[#6873a0] dark:text-indigo-200/70">Nama siswa baru disimpan dengan HURUF KAPITAL. Siswa lama tidak ditimpa; perbedaan huruf besar/kecil saja bukan konflik. Jika nama atau kelas aktif berbeda, perbaiki konfliknya. Semua baris harus lolos sebelum disimpan bersama.</AlertDescription>
      </Alert>
      {!ready && <Alert className="rounded-2xl"><Info className="size-4" /><AlertTitle>Siapkan tahun ajaran dan kelas</AlertTitle><AlertDescription>Buat <Link href="/data-peserta/tahun-ajaran" className="font-semibold text-primary underline">tahun ajaran</Link> dan <Link href="/data-peserta/kelas" className="font-semibold text-primary underline">kelas</Link> terlebih dahulu.</AlertDescription></Alert>}
      {error && <Alert variant="destructive" role="alert" className="rounded-2xl"><CircleAlert className="size-4" /><AlertTitle>Perlu diperiksa</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {completed && <Alert role="status" className="rounded-2xl border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"><CheckCircle2 className="size-4" /><AlertTitle>Impor selesai</AlertTitle><AlertDescription>{completed.newStudents} siswa baru dan {completed.newPlacements} penempatan baru disimpan; {completed.unchanged} baris sudah sesuai. <Link href="/data-peserta/siswa" className="font-semibold underline">Lihat Data Siswa</Link>.</AlertDescription></Alert>}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(270px,0.7fr)]">
        <Card className="min-w-0 gap-0 rounded-[18px] p-5 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)] sm:p-6">
          <div className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><UploadCloud className="size-4" /></span><div><h2 className="text-[15px] font-bold">Pilih file dan tahun ajaran</h2><p className="mt-0.5 text-[11px] text-muted-foreground">Tidak ada perubahan sebelum Anda menyimpan.</p></div></div>
          <form onSubmit={handlePreview} className="mt-5 space-y-4">
            <div className="space-y-2"><label htmlFor="import-period" className="text-sm font-semibold">Tahun ajaran <span className="text-destructive">*</span></label>
              <Select value={periodId} onValueChange={(value) => { setPeriodId(value); clearResult(); }} disabled={Boolean(busy) || periods.length === 0}>
                <SelectTrigger id="import-period" aria-required="true" className="h-11! w-full min-w-0 rounded-xl"><SelectValue placeholder="Pilih tahun ajaran" /></SelectTrigger>
                <SelectContent position="popper">{periods.map((period) => <SelectItem key={period.id} value={period.id}>{period.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><label htmlFor="import-file" className="text-sm font-semibold">File Excel <span className="text-destructive">*</span></label>
              <Input ref={fileRef} id="import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={Boolean(busy)} onChange={(event) => { setFile(event.currentTarget.files?.[0] ?? null); clearResult(); }} className="h-auto min-h-11 w-full min-w-0 rounded-xl py-2 file:mr-3 file:text-xs file:font-semibold" />
              <p className="text-[11px] leading-5 text-muted-foreground">Hanya .xlsx, maksimal 512 KB dan 1.000 baris data. Gunakan teks untuk NISN.</p>
            </div>
            <Button type="submit" disabled={Boolean(busy) || !ready} className="h-10 w-full rounded-xl font-semibold sm:w-auto"><ListChecks className="size-4" /> {busy === "preview" ? "Memeriksa file..." : "Periksa pratinjau"}</Button>
          </form>
        </Card>
        <Card className="min-w-0 gap-0 rounded-[18px] p-5 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)] sm:p-6">
          <div className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"><FileSpreadsheet className="size-4" /></span><div><h2 className="text-[15px] font-bold">Siapkan template</h2><p className="mt-0.5 text-[11px] text-muted-foreground">Sheet <strong>Peserta</strong> · empat kolom</p></div></div>
          <ol className="mt-4 list-decimal space-y-2 pl-4 text-[12px] leading-5 text-muted-foreground"><li>Isi <strong>Nama, NISN, Kelas</strong>; Nomor hanya nomor urut.</li><li>Format NISN sebagai teks, tepat 10 digit, termasuk nol di depan.</li><li>Gunakan kelas yang sudah ada; jangan gunakan rumus atau sel gabungan pada data.</li></ol>
          <Button asChild variant="outline" className="mt-4 h-10 w-full rounded-xl font-semibold"><a href="/templates/template-peserta-nusacbt.xlsx" download><ArrowDownToLine className="size-4" /> Unduh template Excel</a></Button>
        </Card>
      </div>
      {preview && <Card className="min-w-0 gap-0 overflow-hidden rounded-[18px] ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
        <div className="border-b border-border p-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[15px] font-bold">Hasil pratinjau</h2><p className="mt-1 break-words text-[12px] leading-5 text-muted-foreground">Tahun ajaran <strong>{preview.periodName}</strong></p></div><Badge variant={preview.counts.problems ? "destructive" : "secondary"} className="rounded-full text-[10px]">{preview.counts.problems ? "Perlu perbaikan" : "Siap disimpan"}</Badge></div>
          <div className="mt-4"><Summary counts={preview.counts} /></div>
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">Penempatan baru mencakup siswa baru dan siswa lama yang belum ditempatkan pada tahun ajaran ini. Data yang sudah sesuai tidak diubah.</p>
        </div>
        <ul aria-label="Hasil pratinjau impor" className="divide-y divide-border">
          {visibleRows.map((row) => <li key={row.rowNumber} className="min-w-0 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-[13px] font-bold">{row.name || "Nama belum valid"}</p><p className="mt-1 break-words text-[11px] text-muted-foreground">Baris {row.rowNumber} · NISN {row.nisn || "—"} · Kelas {row.className || "—"}</p></div><Badge variant={row.status === "masalah" ? "destructive" : "secondary"} className="rounded-full text-[10px]">{statuses[row.status]}</Badge></div>
            {row.issues.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-5 text-destructive">{row.issues.map((issue, index) => <li key={`${row.rowNumber}-${index}`} className="break-words">{issue}</li>)}</ul>}
          </li>)}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6"><p className="text-[11px] text-muted-foreground">Menampilkan {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, preview.rows.length)} dari {preview.rows.length} baris</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={Boolean(busy) || page === 0} onClick={() => setPage((value) => value - 1)}>Sebelumnya</Button><Button type="button" size="sm" variant="outline" disabled={Boolean(busy) || page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>Berikutnya</Button></div></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-4 sm:px-6"><p className="max-w-xl text-[11px] leading-5 text-muted-foreground">{preview.counts.problems ? "Perbaiki semua baris di Excel, lalu periksa ulang. Tidak ada data yang tersimpan." : "Periksa seluruh hasil. Penyimpanan dilakukan sekaligus dan tidak menimpa data lama."}</p><Button type="button" disabled={Boolean(busy) || !preview.token} onClick={() => setConfirmOpen(true)} className="h-10 rounded-xl font-semibold">Simpan hasil impor</Button></div>
      </Card>}
      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md" showCloseButton={!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
          <DialogHeader><DialogTitle className="text-lg font-bold">Simpan hasil impor?</DialogTitle><DialogDescription>Tahun ajaran <strong className="text-foreground">{preview?.periodName}</strong>. {preview?.counts.newStudents ?? 0} siswa baru dan {preview?.counts.newPlacements ?? 0} penempatan baru akan disimpan. Data yang sudah sesuai tidak diubah.</DialogDescription></DialogHeader>
          <p className="text-[12px] leading-5 text-muted-foreground">Jika data berubah sejak pratinjau, penyimpanan dibatalkan dan Anda perlu memeriksa ulang.</p>
          <DialogFooter><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => setConfirmOpen(false)}>Batal</Button><Button type="button" disabled={Boolean(busy)} onClick={handleSave}>{busy === "save" ? "Menyimpan..." : "Ya, simpan impor"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
