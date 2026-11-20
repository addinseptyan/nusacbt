"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleAlert, Info, Plus, Shuffle, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { saveSessionPlan } from "@/app/data-tes/daftar/sesi/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { distributeExamSessions, SESSION_MAX_CAPACITY, SESSION_MAX_GROUPS } from "@/lib/exam-session-validation.mjs";
import type { SessionPlanPage, SessionStudent } from "@/lib/exam-session-types";

const selectClass = "h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";
const PAGE_SIZE = 25;
type Notice = { message: string; reload?: boolean } | null;

export function SessionPlanManager({ data }: { data: SessionPlanPage }) {
  const router = useRouter(); const { selected, students } = data;
  const [changing, startChanging] = useTransition(); const [pending, startSaving] = useTransition();
  const [capacities, setCapacities] = useState<string[]>(data.groups.length ? data.groups.map((g) => String(g.capacity)) : ["30"]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(students.filter((s) => s.sessionNumber !== null).map((s) => s.studentId)));
  const [classId, setClassId] = useState(""); const [query, setQuery] = useState(""); const [page, setPage] = useState(0);
  const [preview, setPreview] = useState<Map<string, number> | null>(null); const [previewPage, setPreviewPage] = useState(0);
  const [confirming, setConfirming] = useState(false); const [error, setError] = useState<Notice>(null);
  const classes = useMemo(() => {
    const result = new Map<string, string>();
    for (const row of students) if (row.active) result.set(row.classId, row.classLabel);
    return [...result].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [students]);
  const capacitiesAsNumbers = capacities.map((value) => /^\d+$/.test(value) ? Number(value) : 0);
  const selectedRows = students.filter((row) => chosen.has(row.studentId));
  const normalized = query.trim().toLowerCase();
  const filtered = students.filter((row) => !normalized || [row.studentName, row.nisn, row.classLabel].some((s) => s.toLowerCase().includes(normalized)));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); const visiblePage = Math.min(page, pages - 1);
  const visible = filtered.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE);
  const previewPages = Math.max(1, Math.ceil(selectedRows.length / PAGE_SIZE)); const safePreviewPage = Math.min(previewPage, previewPages - 1);
  const previewRows = selectedRows.slice(safePreviewPage * PAGE_SIZE, (safePreviewPage + 1) * PAGE_SIZE);
  const totals = capacities.map((_, index) => preview ? [...preview.values()].filter((number) => number === index + 1).length : 0);
  const invalidCapacity = capacitiesAsNumbers.some((n) => !Number.isInteger(n) || n < 1 || n > SESSION_MAX_CAPACITY);
  const overCapacity = preview !== null && totals.some((count, index) => count > capacitiesAsNumbers[index]);

  function resetPreview() { setPreview(null); setError(null); }
  function toggle(row: SessionStudent, checked: boolean) {
    const next = new Set(chosen); if (checked) next.add(row.studentId); else next.delete(row.studentId);
    setChosen(next); resetPreview();
  }
  function addClass() {
    if (!classId) return;
    const next = new Set(chosen); for (const row of students) if (row.active && row.classId === classId) next.add(row.studentId);
    setChosen(next); resetPreview();
  }
  function generate() {
    setError(null);
    const result = distributeExamSessions(selectedRows.map((row) => ({ studentId: row.studentId, classId: row.classId, sessionNumber: row.sessionNumber })), capacitiesAsNumbers);
    if (!result.ok) { setPreview(null); setError({ message: result.error }); return; }
    setPreview(new Map(result.assignments.map((item) => [item.studentId, item.sessionNumber]))); setPreviewPage(0);
  }
  function changeSession(id: string, value: string) {
    if (!preview) return;
    const next = new Map(preview); next.set(id, Number(value)); setPreview(next); setError(null);
  }
  function save() {
    if (!selected || !preview || invalidCapacity || overCapacity || preview.size !== chosen.size) return;
    const assignments = selectedRows.map((row) => ({ studentId: row.studentId, placementId: row.placementId, sessionNumber: preview.get(row.studentId) }));
    const payload = { periodId: selected.id, expectedRevision: data.revision, capacities: capacitiesAsNumbers, assignments };
    const form = new FormData(); form.set("plan", JSON.stringify(payload)); setError(null);
    startSaving(async () => {
      try {
        const result = await saveSessionPlan(form);
        if (!result.ok) { setConfirming(false); setError({ message: result.error, reload: result.reload }); return; }
        setConfirming(false); toast.success(result.message); router.refresh();
      } catch { setConfirming(false); setError({ message: "Hasil penyimpanan belum dapat dipastikan. Muat ulang sebelum mencoba lagi.", reload: true }); }
    });
  }

  return <div className="max-w-6xl space-y-5">
    <Button asChild variant="ghost" size="sm"><Link href="/data-tes/daftar"><ArrowLeft className="size-4" /> Kembali ke Daftar Tes</Link></Button>
    <Alert className="rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200"><Info className="size-4" /><AlertTitle>Pembagian tetap per periode</AlertTitle><AlertDescription className="text-xs leading-5">Pilih kelas dan siswa, atur kapasitas, lalu acak siswa yang belum memiliki sesi. Siswa yang sudah dibagi tetap pada sesi sebelumnya; perubahan hanya terjadi setelah disimpan. Pembagian ini sendiri belum merilis jadwal tes.</AlertDescription></Alert>
    <Card className="gap-0 rounded-2xl p-5 sm:p-6"><label htmlFor="session-period" className="mb-2 block text-sm font-semibold">Periode <span className="text-destructive">*</span></label><select id="session-period" value={selected?.id ?? ""} onChange={(event) => startChanging(() => router.push(event.target.value ? `/data-tes/daftar/sesi?periode=${encodeURIComponent(event.target.value)}` : "/data-tes/daftar/sesi"))} disabled={changing || pending} className={`${selectClass} max-w-lg`}><option value="">Pilih periode</option>{data.periods.map((period) => <option key={period.id} value={period.id}>{period.name} · {period.startDate}</option>)}</select><p className="mt-3 text-xs leading-5 text-muted-foreground">Periode ini untuk pembagian kelompok; tidak mengubah periode login yang dipilih admin.</p></Card>
    {data.selectionMissing && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertTitle>Periode tidak ditemukan</AlertTitle><AlertDescription>Pilih periode yang tersedia.</AlertDescription></Alert>}
    {selected && <>
      <Card className="gap-0 rounded-2xl p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-bold">1. Jumlah dan kapasitas sesi</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Kapasitas adalah jumlah maksimal siswa dalam kelompok pada periode ini. Atur sesuai jumlah komputer; maksimal {SESSION_MAX_GROUPS} sesi.</p></div><Button type="button" variant="outline" size="sm" disabled={capacities.length >= SESSION_MAX_GROUPS || pending} onClick={() => { setCapacities((old) => [...old, "30"]); resetPreview(); }}><Plus className="size-4" /> Tambah sesi</Button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{capacities.map((capacity, index) => <div key={index} className="rounded-xl border p-3"><label htmlFor={`capacity-${index+1}`} className="mb-1.5 block text-xs font-semibold">Kapasitas sesi {index + 1}</label><Input id={`capacity-${index+1}`} type="number" min={1} max={SESSION_MAX_CAPACITY} step={1} value={capacity} disabled={pending} onChange={(event) => { const next = [...capacities]; next[index] = event.target.value; setCapacities(next); resetPreview(); }} className="h-10" /></div>)}</div>
        {capacities.length > 1 && <Button type="button" variant="ghost" size="sm" className="mt-3 self-start" disabled={pending} onClick={() => { setCapacities((old) => old.slice(0, -1)); resetPreview(); }}>Hapus sesi terakhir</Button>}
        {invalidCapacity && <p role="alert" className="mt-3 text-xs text-destructive">Isi kapasitas 1–{SESSION_MAX_CAPACITY} untuk setiap sesi.</p>}
      </Card>
      <Card className="gap-0 rounded-2xl p-5 sm:p-6"><h2 className="text-base font-bold">2. Pilih siswa</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Tambahkan seluruh kelas, lalu centang siswa lain atau hilangkan centang untuk pengecualian. Pilihan membekukan siswa yang tampak saat ini, bukan mengikuti perubahan kelas otomatis.</p>
        <div className="mt-4 flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1 space-y-1.5"><label htmlFor="session-class" className="block text-xs font-semibold">Kelas untuk ditambahkan</label><select id="session-class" value={classId} onChange={(event) => setClassId(event.target.value)} disabled={pending} className={selectClass}><option value="">Pilih kelas</option>{classes.map((c) => <option value={c.id} key={c.id}>{c.label}</option>)}</select></div><Button type="button" variant="outline" disabled={!classId || pending} onClick={addClass}>Tambahkan kelas</Button></div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-2"><div className="w-full max-w-sm space-y-1.5"><label htmlFor="session-student-search" className="block text-xs font-semibold">Cari siswa</label><Input id="session-student-search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Nama, NISN, atau kelas" className="h-10" /></div><Badge variant="secondary">{chosen.size} siswa dipilih</Badge></div>
        {!visible.length ? <p className="mt-4 rounded-xl bg-muted/50 p-4 text-xs">{students.length ? "Tidak ada siswa yang cocok." : "Belum ada siswa dengan penempatan aktif pada periode ini."}</p> : <ul aria-label="Pilih siswa untuk sesi" className="mt-4 divide-y rounded-xl border">{visible.map((row) => <li key={row.studentId} className="p-3"><label className="flex cursor-pointer items-start gap-2"><input type="checkbox" aria-label={`Pilih ${row.studentName} ${row.nisn}`} checked={chosen.has(row.studentId)} disabled={pending || (!row.active && row.sessionNumber === null)} onChange={(event) => toggle(row, event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" /><span className="min-w-0 break-words text-xs leading-5"><strong>{row.studentName}</strong> · NISN {row.nisn} · {row.classLabel}{row.sessionNumber !== null && <> · <strong>Sesi {row.sessionNumber} tersimpan</strong></>}{!row.active && <span className="text-destructive"> · kelas tidak aktif</span>}</span></label></li>)}</ul>}
        {pages > 1 && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span>Halaman {visiblePage+1} dari {pages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={visiblePage===0} onClick={() => setPage(visiblePage-1)}>Sebelumnya</Button><Button size="sm" variant="outline" disabled={visiblePage+1>=pages} onClick={() => setPage(visiblePage+1)}>Berikutnya</Button></div></div>}
        <div className="mt-4 flex flex-wrap gap-2"><Button type="button" disabled={invalidCapacity || pending} onClick={generate}><Shuffle className="size-4" /> Acak pembagian</Button><span className="self-center text-xs text-muted-foreground">Siswa yang sudah tersimpan tidak diacak ulang.</span></div>
      </Card>
      {preview && <Card className="gap-0 rounded-2xl p-5 sm:p-6"><h2 className="text-base font-bold">3. Periksa dan sesuaikan</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Siswa baru diacak per kelas dan disebar semerata mungkin sesuai kapasitas. Anda dapat memindahkan siswa dengan sengaja sebelum menyimpan. Mengubah pilihan atau kapasitas membatalkan pratinjau.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{capacities.map((_, i) => <div key={i} className={`rounded-xl border p-3 text-xs ${totals[i] > capacitiesAsNumbers[i] ? "border-destructive text-destructive" : ""}`}><p className="font-semibold">Sesi {i+1}</p><p className="mt-1">{totals[i]} / {capacitiesAsNumbers[i]} siswa</p></div>)}</div>
        {overCapacity && <p role="alert" className="mt-3 text-xs text-destructive">Ada sesi yang melebihi kapasitas. Pindahkan siswa sebelum menyimpan.</p>}
        {previewRows.length ? <ul aria-label="Pratinjau pembagian sesi" className="mt-4 divide-y rounded-xl border">{previewRows.map((row) => <li key={row.studentId} className="flex flex-wrap items-center justify-between gap-3 p-3"><div className="min-w-0 break-words text-xs leading-5"><strong>{row.studentName}</strong> · {row.nisn} · {row.classLabel}{!row.active && <span className="text-destructive"> · kelas tidak aktif; tidak dapat dipindah</span>}</div><select aria-label={`Sesi ${row.studentName} ${row.nisn}`} value={preview.get(row.studentId)} onChange={(event) => changeSession(row.studentId,event.target.value)} disabled={pending || !row.active} className={`${selectClass} max-w-36`}>{capacities.map((_,i) => <option value={i+1} key={i}>Sesi {i+1}</option>)}</select></li>)}</ul> : <p className="mt-4 text-xs text-muted-foreground">Belum ada siswa dipilih. Kelompok kosong dapat disimpan dan diisi nanti.</p>}
        {previewPages > 1 && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span>Halaman pratinjau {safePreviewPage+1} dari {previewPages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={safePreviewPage===0} onClick={() => setPreviewPage(safePreviewPage-1)}>Sebelumnya</Button><Button size="sm" variant="outline" disabled={safePreviewPage+1>=previewPages} onClick={() => setPreviewPage(safePreviewPage+1)}>Berikutnya</Button></div></div>}
        <Alert className="mt-4 rounded-xl"><UsersRound className="size-4" /><AlertDescription className="text-xs leading-5">Jadwal yang sudah dirilis tidak dipindahkan otomatis. Untuk memindah/mengeluarkan siswa yang sudah memiliki jadwal reguler dirilis, tarik rilis pelaksanaan terkait terlebih dahulu. Siswa baru tidak otomatis masuk saat penempatan kelas berubah.</AlertDescription></Alert>
        <Button type="button" className="mt-4 self-start" disabled={pending || invalidCapacity || overCapacity} onClick={() => setConfirming(true)}>Simpan pembagian sesi</Button>
      </Card>}
      {error && <Alert variant="destructive" role="alert" className="rounded-2xl"><CircleAlert className="size-4" /><AlertTitle>Pembagian belum disimpan</AlertTitle><AlertDescription>{error.message}{error.reload && <Button type="button" size="sm" variant="outline" className="mt-3 block" onClick={() => router.refresh()}>Muat ulang</Button>}</AlertDescription></Alert>}
    </>}
    {confirming && selected && <Dialog open onOpenChange={(open) => { if (!open && !pending) setConfirming(false); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg" showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}><DialogHeader><DialogTitle>Simpan pembagian sesi?</DialogTitle><DialogDescription>Periode <strong className="text-foreground">{selected.name}</strong> · {selectedRows.length} siswa · {capacities.length} sesi. Daftar yang tersimpan akan diganti sesuai pratinjau; jadwal yang dirilis tidak berubah otomatis.</DialogDescription></DialogHeader><ul className="space-y-1 text-xs">{totals.map((total, i) => <li key={i}>Sesi {i+1}: {total} dari {capacitiesAsNumbers[i]} tempat</li>)}</ul><DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>Batal</Button><Button type="button" disabled={pending} onClick={save}>{pending ? "Menyimpan..." : "Ya, simpan pembagian"}</Button></DialogFooter></DialogContent></Dialog>}
  </div>;
}
