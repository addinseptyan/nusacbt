"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ClipboardList, Eye, Info, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { deleteExamTest, saveExamTest } from "@/app/data-tes/daftar/actions";
import { QuestionRichDisplay } from "@/components/question-rich-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ExamPeriodOption, ExamTest, ExamTimeZone } from "@/lib/exam-test-types";
import { EXAM_TEST_FORM_VERSION, EXAM_TEST_MAX_DURATION, EXAM_TEST_MAX_QUESTIONS, validateExamStart } from "@/lib/exam-test-validation.mjs";
import type { Question, QuestionImageSlot, QuestionTopicOption } from "@/lib/question-types";

const PAGE_SIZE = 10;
const selectClass = "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";
const dialogClass = "max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-4xl";
type Notice = { message: string; reload?: boolean } | null;

function formatLocal(value: string) {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)} ${value.slice(11, 16)}`;
}
function excerpt(question: Question) {
  const text = question.prompt.replace(/\s+/g, " ").trim();
  return text.length > 150 ? `${text.slice(0, 150)}…` : text || (question.hasPromptImage ? "[Gambar soal]" : "[Isi soal kosong]");
}
function ErrorNotice({ error, onReload }: { error: NonNullable<Notice>; onReload: () => void }) {
  return <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription><span>{error.message}</span>{error.reload && <Button type="button" variant="outline" size="sm" className="mt-3 block" onClick={onReload}>Muat ulang daftar</Button>}</AlertDescription></Alert>;
}
function TestQuestionImage({ question, slot, alt }: { question: Question; slot: QuestionImageSlot; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p role="status" className="mt-2 text-xs text-destructive">Gambar tidak dapat dimuat atau soal telah berubah. Muat ulang daftar.</p>;
  return <Image unoptimized src={`/api/admin/soal/${question.id}/${slot}?versi=${encodeURIComponent(question.revision)}`} width={360} height={220} alt={alt} onError={() => setFailed(true)} className="mt-2 h-auto max-h-44 w-auto max-w-full rounded-lg border border-border object-contain" />;
}
export function QuestionPreview({ question }: { question: Question }) {
  return <div className="mt-3 min-w-0 space-y-3 rounded-xl border border-border bg-background p-3 text-sm">
    <div><p className="mb-1 text-xs font-bold">Isi soal #{question.id}</p><QuestionRichDisplay document={question.promptRich} fallback={question.prompt} />{question.hasPromptImage && <TestQuestionImage question={question} slot="prompt" alt={`Gambar soal ${question.id}`} />}</div>
    <div className="space-y-2"><p className="text-xs font-bold">Pilihan dan kunci untuk admin</p>{question.options.map((option) => <div key={option.letter} className="rounded-lg border p-2"><p className="text-xs font-semibold">{option.letter}. {question.correctOption === option.letter && <span className="text-primary">Jawaban benar</span>}</p><QuestionRichDisplay document={option.rich} fallback={option.text} />{option.hasImage && <TestQuestionImage question={question} slot={option.letter} alt={`Gambar pilihan ${option.letter} soal ${question.id}`} />}</div>)}</div>
  </div>;
}

function ExamTestEditor({ test, periods, topics, questions, onClose }: { test: ExamTest | null; periods: ExamPeriodOption[]; topics: QuestionTopicOption[]; questions: Question[]; onClose: () => void }) {
  const router = useRouter();
  // Pertahankan snapshot yang dilihat ketika dialog dibuka; server tetap
  // memeriksa revisi setiap soal sebelum menyimpan.
  const [bank] = useState(questions);
  const byId = useMemo(() => new Map(bank.map((question) => [question.id, question])), [bank]);
  const [selected, setSelected] = useState<string[]>(test?.questionIds ?? []);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const [query, setQuery] = useState(""); const [topicId, setTopicId] = useState(""); const [page, setPage] = useState(0); const [previewId, setPreviewId] = useState<string | null>(null);
  const [startLocal, setStartLocal] = useState(test?.startLocal ?? "");
  const [timeZone, setTimeZone] = useState<ExamTimeZone>(test?.timeZone ?? "WIB");
  const [duration, setDuration] = useState(String(test?.durationMinutes ?? 60));
  const [error, setError] = useState<Notice>(null); const [selectionError, setSelectionError] = useState(""); const [pending, startTransition] = useTransition();
  const normalized = query.trim().toLowerCase();
  const filtered = bank.filter((question) => (!topicId || question.topicId === topicId) && (!normalized || [question.id, question.prompt, question.topicName, ...question.options.map((option) => option.text)].some((text) => text.toLowerCase().includes(normalized))));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const start = validateExamStart(startLocal, timeZone);
  const minutes = /^[1-9]\d{0,4}$/.test(duration) ? Number(duration) : 0;
  const end = start.ok && minutes > 0 && minutes <= EXAM_TEST_MAX_DURATION ? new Date(Date.parse(`${startLocal}:00Z`) + minutes * 60_000).toISOString().slice(0, 16) : null;

  function close() { if (!pending) onClose(); }
  function reload() { if (!pending) { onClose(); router.refresh(); } }
  function toggle(id: string) {
    setSelectionError("");
    if (selectedSet.has(id)) { setSelected((current) => current.filter((item) => item !== id)); return; }
    if (selected.length >= EXAM_TEST_MAX_QUESTIONS) { setSelectionError("Maksimal 1000 soal per tes."); return; }
    setSelected((current) => [...current, id]);
  }
  function selectAll() {
    const added = filtered.filter((item) => !selectedSet.has(item.id)).map((item) => item.id);
    if (selected.length + added.length > EXAM_TEST_MAX_QUESTIONS) { setSelectionError("Hasil pencarian melebihi batas 1000 soal per tes. Gunakan filter atau pilih sebagian."); return; }
    setSelectionError(""); setSelected((current) => [...current, ...added]);
  }
  function move(index: number, direction: -1 | 1) {
    setSelected((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]]; return next;
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("formVersion", EXAM_TEST_FORM_VERSION);
    if (test) { data.set("id", test.id); data.set("revision", test.revision); }
    for (const id of selected) {
      const question = byId.get(id);
      if (!question) { setError({ message: "Daftar soal tidak lengkap. Muat ulang halaman sebelum menyimpan.", reload: true }); return; }
      data.append("questionIds", id); data.append("questionRevisions", question.revision);
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveExamTest(data);
        if (!result.ok) { setError({ message: result.error, reload: result.reload }); return; }
        onClose(); toast.success(result.message); router.refresh();
      } catch { setError({ message: "Hasil penyimpanan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar sebelum mencoba lagi.", reload: true }); }
    });
  }

  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
      <DialogHeader><DialogTitle className="text-lg font-bold">{test ? "Ubah rancangan tes" : "Tambah rancangan tes"}</DialogTitle><DialogDescription>Data baru tersimpan setelah tombol Simpan berhasil. Tarik rilis seluruh pelaksanaan sebelum mengubah rancangan. Peserta belum dapat mengerjakan tes pada tahap ini.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-5 pt-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><label htmlFor="test-name" className="text-sm font-semibold">Nama tes <span className="text-destructive">*</span></label><Input id="test-name" name="name" maxLength={200} defaultValue={test?.name ?? ""} required disabled={pending} placeholder="Contoh: Matematika Semester Ganjil" className="h-11 rounded-xl" /></div>
          <div className="space-y-2"><label htmlFor="test-period" className="text-sm font-semibold">Periode ujian <span className="text-destructive">*</span></label><select id="test-period" name="periodId" defaultValue={test?.periodId ?? ""} required disabled={pending} className={selectClass}><option value="">Pilih periode</option>{periods.map((period) => <option key={period.id} value={period.id}>{period.name} ({period.startDate}{period.endDate ? ` – ${period.endDate}` : " dan seterusnya"})</option>)}</select></div>
          <div className="space-y-2"><label htmlFor="test-zone" className="text-sm font-semibold">Zona waktu <span className="text-destructive">*</span></label><select id="test-zone" name="timeZone" value={timeZone} onChange={(event) => setTimeZone(event.target.value as ExamTimeZone)} required disabled={pending} className={selectClass}><option value="WIB">WIB (UTC+7)</option><option value="WITA">WITA (UTC+8)</option><option value="WIT">WIT (UTC+9)</option></select></div>
          <div className="space-y-2"><label htmlFor="test-start" className="text-sm font-semibold">Tanggal dan waktu mulai <span className="text-destructive">*</span></label><Input id="test-start" name="startLocal" type="datetime-local" min="2000-01-01T00:00" max="2100-12-31T23:59" step={60} value={startLocal} onChange={(event) => setStartLocal(event.target.value)} required disabled={pending} className="h-11 rounded-xl" /></div>
          <div className="space-y-2"><label htmlFor="test-duration" className="text-sm font-semibold">Durasi (menit) <span className="text-destructive">*</span></label><Input id="test-duration" name="durationMinutes" type="number" min={1} max={EXAM_TEST_MAX_DURATION} step={1} value={duration} onChange={(event) => setDuration(event.target.value)} required disabled={pending} className="h-11 rounded-xl" /></div>
        </div>
        <p className="rounded-xl bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">Ini adalah jadwal dasar rancangan; waktu tiap sesi diatur pada Pelaksanaan. Waktu memakai zona yang dipilih, bukan zona browser. Akhir terjadwal = mulai + durasi.{end && <> Perkiraan akhir: <strong className="text-foreground">{formatLocal(end)} {timeZone}</strong>.</>} Saat modul pengerjaan tersedia, peserta terlambat hanya mendapat sisa waktu hingga akhir terjadwal.</p>
        <fieldset disabled={pending} className="space-y-2 rounded-xl border border-border p-4"><legend className="px-1 text-sm font-bold">Pengaturan acak</legend><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shuffleQuestions" value="1" defaultChecked={test?.shuffleQuestions ?? false} className="size-4 accent-primary" /> Acak urutan soal</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shuffleOptions" value="1" defaultChecked={test?.shuffleOptions ?? false} className="size-4 accent-primary" /> Acak urutan pilihan jawaban</label><p className="text-xs leading-5 text-muted-foreground">Pengaturan disimpan sebagai rancangan; pengacakan saat pengerjaan belum diimplementasikan.</p></fieldset>
        <fieldset disabled={pending} className="space-y-3 rounded-xl border border-border p-4"><legend className="px-1 text-sm font-bold">Pilih soal dari bank</legend>
          <p className="text-xs leading-5 text-muted-foreground">Boleh kosong saat menyusun rancangan. Pilih maksimal 1000 soal. Saat acak soal tidak aktif, urutan mengikuti daftar soal terpilih di bawah. Perubahan isi soal di bank akan terlihat pada rancangan ini.</p>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><label htmlFor="test-question-search" className="text-xs font-semibold">Cari soal bank</label><Input id="test-question-search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); setPreviewId(null); }} placeholder="Isi, pilihan, topik, atau ID" className="h-10" /></div><div className="space-y-1"><label htmlFor="test-topic" className="text-xs font-semibold">Filter topik / mata pelajaran</label><select id="test-topic" value={topicId} onChange={(event) => { setTopicId(event.target.value); setPage(0); setPreviewId(null); }} className={selectClass}><option value="">Semua topik</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></div></div>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{filtered.length} soal cocok · {selected.length} terpilih</p><Button type="button" variant="outline" size="sm" onClick={selectAll} disabled={!filtered.length}>Pilih semua hasil</Button></div>
          {selectionError && <p role="alert" className="text-xs text-destructive">{selectionError}</p>}
          {!bank.length ? <p className="rounded-xl bg-muted/50 p-3 text-xs">Belum ada soal. <Link href="/data-modul/soal" className="font-semibold text-primary underline">Buka Manajemen Soal</Link>.</p> : !filtered.length ? <p className="rounded-xl bg-muted/50 p-3 text-xs">Tidak ada soal yang cocok dengan filter.</p> : <ul aria-label="Hasil soal bank" className="divide-y divide-border rounded-xl border border-border">{visible.map((question) => <li key={question.id} className="min-w-0 p-3"><div className="flex items-start gap-2"><label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2"><input type="checkbox" aria-label={`Pilih soal ${question.id}`} checked={selectedSet.has(question.id)} onChange={() => toggle(question.id)} className="mt-0.5 size-4 shrink-0 accent-primary" /><span className="min-w-0 text-xs leading-5"><span className="font-bold">#{question.id} · {question.topicName}</span><span className="block break-words text-muted-foreground">{excerpt(question)}</span></span></label><Button type="button" variant="ghost" size="sm" aria-label={`Lihat isi soal ${question.id}`} aria-expanded={previewId === question.id} onClick={() => setPreviewId(previewId === question.id ? null : question.id)}><Eye className="size-4" /> Lihat</Button></div>{previewId === question.id && <QuestionPreview key={question.id} question={question} />}</li>)}</ul>}
          {filtered.length > PAGE_SIZE && <div className="flex items-center justify-between gap-2 text-xs"><span>Halaman {currentPage + 1} dari {pageCount}</span><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setPreviewId(null); }}><ChevronLeft className="size-4" /> Sebelumnya</Button><Button type="button" variant="outline" size="sm" disabled={currentPage + 1 >= pageCount} onClick={() => { setPage(currentPage + 1); setPreviewId(null); }}>Berikutnya <ChevronRight className="size-4" /></Button></div></div>}
          <div className="space-y-2 border-t border-border pt-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold">Urutan soal terpilih ({selected.length})</p><Button type="button" variant="ghost" size="sm" disabled={!selected.length} onClick={() => { setSelected([]); setSelectionError(""); }}>Lepas semua</Button></div>
            {!selected.length ? <p className="text-xs text-muted-foreground">Belum ada soal terpilih.</p> : <ol aria-label="Urutan soal terpilih" className="max-h-64 space-y-2 overflow-y-auto pr-1">{selected.map((id, index) => <li key={id} className="flex min-w-0 items-center gap-1 rounded-lg bg-muted/40 p-2 text-xs"><span className="min-w-0 flex-1 break-words">{index + 1}. #{id} · {byId.has(id) ? excerpt(byId.get(id)!) : "Soal tidak ditemukan; muat ulang daftar."}</span><Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} aria-label={`Naikkan soal ${id}`} onClick={() => move(index, -1)}><ArrowUp className="size-4" /></Button><Button type="button" variant="ghost" size="icon-sm" disabled={index === selected.length - 1} aria-label={`Turunkan soal ${id}`} onClick={() => move(index, 1)}><ArrowDown className="size-4" /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label={`Lepas soal ${id}`} onClick={() => toggle(id)}><X className="size-4" /></Button></li>)}</ol>}
          </div>
        </fieldset>
        {error && <ErrorNotice error={error} onReload={reload} />}
        <DialogFooter className="-mx-4 -mb-4 rounded-b-2xl"><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan rancangan"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function DeleteTestDialog({ test, onClose }: { test: ExamTest; onClose: () => void }) {
  const router = useRouter(); const [error, setError] = useState<Notice>(null); const [pending, startTransition] = useTransition();
  function close() { if (!pending) onClose(); }
  function reload() { close(); router.refresh(); }
  function remove() {
    const data = new FormData(); data.set("id", test.id); data.set("revision", test.revision); setError(null);
    startTransition(async () => {
      try { const result = await deleteExamTest(data); if (!result.ok) { setError({ message: result.error, reload: result.reload }); return; } onClose(); toast.success(result.message); router.refresh(); }
      catch { setError({ message: "Hasil penghapusan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar sebelum mencoba lagi.", reload: true }); }
    });
  }
  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md" showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>Hapus rancangan tes?</DialogTitle><DialogDescription>Rancangan <strong className="break-words text-foreground">{test.name}</strong> dan daftar pilihannya akan dihapus permanen. Jika masih memiliki pelaksanaan, tarik rilis dan hapus seluruh pelaksanaan terlebih dahulu. Soal pada bank tidak dihapus. Token khusus tes ini menjadi tidak berlaku; riwayat metadatanya tetap ada. Token global tidak berubah.</DialogDescription></DialogHeader>
    {error && <ErrorNotice error={error} onReload={reload} />}
    <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="button" variant="destructive" disabled={pending} onClick={remove}>{pending ? "Menghapus..." : "Ya, hapus rancangan"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function ExamTestManager({ periods, tests, topics, questions }: { periods: ExamPeriodOption[]; tests: ExamTest[]; topics: QuestionTopicOption[]; questions: Question[] }) {
  const [query, setQuery] = useState(""); const [periodId, setPeriodId] = useState(""); const [page, setPage] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false); const [editing, setEditing] = useState<ExamTest | null>(null); const [deleting, setDeleting] = useState<ExamTest | null>(null);
  const normalized = query.trim().toLowerCase();
  const filtered = tests.filter((test) => (!periodId || test.periodId === periodId) && (!normalized || [test.name, test.periodName, test.id].some((value) => value.toLowerCase().includes(normalized))));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); const currentPage = Math.min(page, pages - 1); const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  function openEditor(test: ExamTest | null) { setEditing(test); setEditorOpen(true); }
  return <>
    <Alert className="mb-6 max-w-4xl rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200"><Info className="size-4" /><AlertTitle className="text-[12px] font-bold">Rancangan admin, belum untuk ujian</AlertTitle><AlertDescription className="text-[12px] leading-5">Peserta hanya melihat pelaksanaan yang dirilis untuknya. Atur kelompok sesi per periode, lalu buka pelaksanaan pada tiap tes. Jadwal lama tidak terlihat sampai diatur dan dirilis. Pemeriksaan token, pengerjaan, timer, snapshot, dan penilaian belum tersedia.</AlertDescription></Alert>
    {!periods.length && <Alert className="mb-5 rounded-2xl"><Info className="size-4" /><AlertTitle>Periode diperlukan</AlertTitle><AlertDescription>Buat periode terlebih dahulu di <Link href="/data-peserta/periode" className="font-semibold text-primary underline">Periode Ujian</Link>.</AlertDescription></Alert>}
    <Card className="gap-0 overflow-hidden rounded-[18px] bg-card py-0 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5 sm:px-6"><div><div className="flex items-center gap-2.5"><h2 className="text-[15px] font-bold">Rancangan tes</h2><Badge variant="secondary" className="rounded-full text-[10px]">{tests.length} tes</Badge></div><p className="mt-1 text-[12px] text-muted-foreground">Kelola jadwal dan susunan soal. Semua tes masih berupa rancangan.</p></div><div className="flex flex-wrap gap-2"><Button asChild variant="outline" className="h-10 rounded-xl px-4 font-semibold"><Link href="/data-tes/daftar/sesi">Atur kelompok sesi</Link></Button><Button onClick={() => openEditor(null)} disabled={!periods.length} className="h-10 rounded-xl px-4 font-semibold"><Plus className="size-4" /> Tambah tes</Button></div></div>
      <div className="grid gap-3 border-b border-border p-5 sm:grid-cols-2 sm:px-6"><div className="relative"><Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" /><Input aria-label="Cari tes" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Cari nama atau ID tes" className="h-10 pl-9" /></div><select aria-label="Filter periode tes" value={periodId} onChange={(event) => { setPeriodId(event.target.value); setPage(0); }} className={selectClass}><option value="">Semua periode</option>{periods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}</select></div>
      {!visible.length ? <div className="flex flex-col items-center px-6 py-14 text-center"><span className="flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><ClipboardList className="size-6" /></span><h3 className="mt-4 text-sm font-bold">{tests.length ? "Tidak ada tes yang cocok" : "Belum ada rancangan tes"}</h3><p className="mt-1.5 max-w-sm text-[12px] leading-6 text-muted-foreground">{tests.length ? "Ubah pencarian atau filter periode." : "Buat rancangan setelah periode ujian tersedia."}</p></div> : <ul aria-label="Daftar rancangan tes" className="divide-y divide-border">{visible.map((test) => <li key={test.id} className="flex flex-col gap-4 p-5 sm:px-6 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-bold">{test.name}</h3><Badge variant="outline" className="rounded-full text-[10px]">Rancangan</Badge></div><p className="mt-1 break-words text-xs text-muted-foreground">#{test.id} · {test.periodName} · {test.questionIds.length} soal</p><p className="mt-2 text-xs leading-5 text-muted-foreground">Mulai: <strong className="text-foreground">{formatLocal(test.startLocal)} {test.timeZone}</strong> · Akhir: <strong className="text-foreground">{formatLocal(test.endLocal)} {test.timeZone}</strong> · {test.durationMinutes} menit</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Acak soal: {test.shuffleQuestions ? "aktif" : "tidak"} · Acak pilihan: {test.shuffleOptions ? "aktif" : "tidak"}</p></div><div className="flex flex-wrap shrink-0 gap-2"><Button asChild variant="default" size="sm"><Link href={`/data-tes/daftar/${test.id}`} aria-label={`Pelaksanaan tes ${test.id}`}>Pelaksanaan</Link></Button><Button type="button" variant="outline" size="sm" aria-label={`Ubah tes ${test.id}`} onClick={() => openEditor(test)}><Pencil className="size-3.5" /> Ubah</Button><Button type="button" variant="outline" size="sm" aria-label={`Hapus tes ${test.id}`} onClick={() => setDeleting(test)} className="text-destructive hover:text-destructive"><Trash2 className="size-3.5" /> Hapus</Button></div></li>)}</ul>}
      {filtered.length > PAGE_SIZE && <div className="flex items-center justify-between gap-2 border-t border-border p-5 text-xs sm:px-6"><span>Halaman {currentPage + 1} dari {pages}</span><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="size-4" /> Sebelumnya</Button><Button type="button" variant="outline" size="sm" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Berikutnya <ChevronRight className="size-4" /></Button></div></div>}
    </Card>
    {editorOpen && <ExamTestEditor test={editing} periods={periods} topics={topics} questions={questions} onClose={() => setEditorOpen(false)} />}
    {deleting && <DeleteTestDialog test={deleting} onClose={() => setDeleting(null)} />}
  </>;
}
