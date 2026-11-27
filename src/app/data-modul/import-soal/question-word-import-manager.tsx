"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, CheckCircle2, CircleAlert, FileText, Info, ListChecks, UploadCloud } from "lucide-react";

import { previewQuestionWord, saveQuestionWord } from "@/app/data-modul/import-soal/actions";
import { QuestionRichDisplay } from "@/components/question-rich-display";
import { SearchableCombobox, type ComboboxOption } from "@/components/searchable-combobox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { QuestionImportPart, QuestionImportPreview } from "@/lib/question-import-types";
import type { QuestionTopicOption } from "@/lib/question-types";

const MAX_SIZE = 6 * 1024 * 1024;
const PAGE_SIZE = 3;

function Part({ part, label }: { part: QuestionImportPart; label: string }) {
  return <div className="min-w-0 text-sm"><QuestionRichDisplay document={part.rich} fallback={part.text} />{part.imageUrl && <Image unoptimized src={part.imageUrl} width={360} height={220} alt={label} className="mt-2 h-auto max-h-44 w-auto max-w-full rounded-lg border border-border object-contain" />}</div>;
}

export function QuestionWordImportManager({ topics }: { topics: QuestionTopicOption[] }) {
  const router = useRouter();
  const [topicId, setTopicId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<QuestionImportPreview | null>(null);
  const [completed, setCompleted] = useState<{ count: number; alreadySaved: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [page, setPage] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const pages = preview ? Math.ceil(preview.questions.length / PAGE_SIZE) : 0;
  const visible = preview?.questions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];
  const topicOptions = useMemo<ComboboxOption[]>(
    () =>
      topics.map((t) => ({
        value: t.id,
        label: t.name,
        tags: t.tags ?? [],
        badge: `${t.questionCount ?? 0} soal`,
      })),
    [topics],
  );

  function clearResult() { setPreview(null); setCompleted(null); setError(""); setPage(0); }
  function makeForm() {
    const data = new FormData();
    data.set("topicId", topicId);
    if (file) data.set("file", file);
    return data;
  }
  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    clearResult();
    if (!topicId) return setError("Pilih topik atau mata pelajaran terlebih dahulu.");
    if (!file || !file.name.toLowerCase().endsWith(".docx")) return setError("Pilih file Word .docx.");
    if (!file.size || file.size > MAX_SIZE) return setError("Ukuran file harus lebih dari 0 dan maksimal 6 MiB.");
    setBusy("preview");
    try {
      const result = await previewQuestionWord(makeForm());
      if (!result.ok) return setError(result.error);
      setPreview(result.preview);
    } catch { setError("Pratinjau belum dapat dibuat. Periksa sesi dan koneksi, lalu coba lagi."); }
    finally { setBusy(null); }
  }
  async function handleSave() {
    if (busy || !preview || !file || !topicId) return;
    const data = makeForm(); data.set("previewToken", preview.token); data.set("operationId", preview.operationId);
    setError(""); setBusy("save");
    try {
      const result = await saveQuestionWord(data);
      setConfirmOpen(false);
      // Keep the preview and operation ID even on a returned error: a failed
      // response may follow a successful COMMIT. Retrying this preview is idempotent.
      if (!result.ok) return setError(result.error);
      setCompleted({ count: result.count, alreadySaved: result.alreadySaved });
      setPreview(null); setFile(null); if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch {
      setConfirmOpen(false);
      // Keep the same preview/operation ID: retrying it is idempotent.
      setError("Hasil penyimpanan belum dapat dipastikan. Periksa Manajemen Soal; jika perlu, coba simpan lagi pratinjau yang sama.");
    } finally { setBusy(null); }
  }

  return <div className="max-w-6xl space-y-5">
    <Alert className="rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200"><Info className="size-4 text-[#727fc8] dark:text-indigo-300" /><AlertTitle className="text-[12px] font-bold">Periksa pratinjau sebelum menyimpan</AlertTitle><AlertDescription className="mt-0.5 text-[12px] leading-5 text-[#6873a0] dark:text-indigo-200/70">Semua soal ditambahkan ke satu kategori yang dipilih. Impor tidak menimpa soal lama; impor ulang sebagai pratinjau baru akan membuat duplikat. Rumus yang belum didukung menolak seluruh file. Hanya isi tabel utama diproses; teks di luar tabel tidak diimpor.</AlertDescription></Alert>
    {topics.length === 0 && <Alert><Info className="size-4" /><AlertTitle>Siapkan kategori</AlertTitle><AlertDescription>Tambahkan <Link href="/data-modul/topik" className="underline">topik atau mata pelajaran</Link> terlebih dahulu.</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert" className="rounded-2xl"><CircleAlert className="size-4" /><AlertTitle>Perlu diperiksa</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {completed && <Alert role="status" className="rounded-2xl border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"><CheckCircle2 className="size-4" /><AlertTitle>Impor selesai</AlertTitle><AlertDescription>{completed.alreadySaved ? "Pratinjau ini sebelumnya sudah tersimpan; tidak ada soal ganda yang ditambahkan." : `${completed.count} soal berhasil ditambahkan.`} <Link href="/data-modul/soal" className="font-semibold underline">Lihat Bank Soal</Link>.</AlertDescription></Alert>}
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(270px,0.7fr)]">
      <Card className="min-w-0 gap-0 rounded-[18px] p-5 ring-1 ring-border sm:p-6">
        <div className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><UploadCloud className="size-4" /></span><div><h2 className="text-[15px] font-bold">Pilih file dan kategori</h2><p className="mt-0.5 text-[11px] text-muted-foreground">Belum ada perubahan sampai impor disimpan.</p></div></div>
        <form onSubmit={handlePreview} className="mt-5 space-y-4">
          <div className="space-y-2">
            <label htmlFor="question-import-topic" className="text-sm font-semibold">Topik / mata pelajaran <span className="text-destructive">*</span></label>
            <SearchableCombobox
              id="question-import-topic"
              name="topicId"
              options={topicOptions}
              value={topicId}
              onChange={(val) => { setTopicId(val); clearResult(); }}
              placeholder="Pilih kategori"
              searchPlaceholder="Cari nama mata pelajaran atau tag..."
              required
              disabled={Boolean(busy) || topics.length === 0}
            />
          </div>
          <div className="space-y-2"><label htmlFor="question-import-file" className="text-sm font-semibold">File Word <span className="text-destructive">*</span></label><Input ref={fileRef} id="question-import-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={Boolean(busy)} onChange={(event) => { setFile(event.currentTarget.files?.[0] ?? null); clearResult(); }} className="h-auto min-h-11 w-full min-w-0 rounded-xl py-2 file:mr-3 file:text-xs file:font-semibold" /><p className="text-[11px] leading-5 text-muted-foreground">Hanya .docx, maksimal 6 MiB dan 100 soal per file. PDF tidak dapat diimpor.</p></div>
          <Button type="submit" disabled={Boolean(busy) || !topics.length || Boolean(preview)} className="h-10 w-full rounded-xl font-semibold sm:w-auto">{busy === "preview" ? <Spinner aria-hidden="true" /> : <ListChecks className="size-4" />} {busy === "preview" ? "Memeriksa file..." : "Periksa pratinjau"}</Button>
        </form>
      </Card>
      <Card className="min-w-0 gap-0 rounded-[18px] p-5 ring-1 ring-border sm:p-6">
        <div className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"><FileText className="size-4" /></span><div><h2 className="text-[15px] font-bold">Format dokumen</h2><p className="mt-0.5 text-[11px] text-muted-foreground">Kolom No · Jenis · Isi · Jawaban</p></div></div>
        <ol className="mt-4 list-decimal space-y-2 pl-4 text-[12px] leading-5 text-muted-foreground"><li>Setiap baris <strong>SOAL</strong> diikuti lima baris <strong>JAWABAN</strong>.</li><li>Isi 1 pada satu jawaban benar, dan 0 pada empat lainnya.</li><li>Tabel di isi soal, Arab, dan sebagian Equation dasar dapat dibaca. Periksa pratinjau; jenis font, ukuran, dan tata letak Word bisa berbeda. Word 2013 belum diuji langsung.</li><li>Maksimal satu gambar PNG/JPEG per bagian, ditampilkan setelah teks; gambar di dalam tabel belum didukung. Total gambar setelah diproses maksimal 16 MiB per file, termasuk pemakaian berulang. Jika melebihi batas, bagi dokumen menjadi beberapa file.</li></ol>
        <Button asChild variant="outline" className="mt-4 h-10 w-full rounded-xl font-semibold"><a href="/templates/template-soal-nusacbt.docx" download><ArrowDownToLine className="size-4" /> Unduh template Word</a></Button>
      </Card>
    </div>
    {preview && <Card className="min-w-0 gap-0 overflow-hidden rounded-[18px] ring-1 ring-border">
      <div className="border-b border-border p-5 sm:px-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[15px] font-bold">Pratinjau soal</h2><p className="mt-1 break-words text-[12px] leading-5 text-muted-foreground">Kategori <strong>{preview.topicName}</strong> · {preview.questions.length} soal · belum disimpan</p></div><Badge variant="secondary" className="rounded-full text-[10px]">Siap diperiksa</Badge></div><p className="mt-3 text-[11px] leading-5 text-muted-foreground">Periksa setiap soal, pilihan, tabel, gambar, dan rumus. Tata letak dan pemformatan kompleks Word dapat berbeda. Gambar ditampilkan setelah isi teks, bukan di posisi aslinya.</p></div>
      <ol aria-label="Pratinjau impor soal" className="divide-y divide-border">
        {visible.map((question) => <li key={question.number} className="min-w-0 space-y-3 p-5 sm:px-6"><h3 className="text-sm font-bold">Soal {question.number}</h3><Part part={question.prompt} label={`Gambar soal ${question.number}`} /><div className="grid gap-2">{question.options.map((option, index) => { const letter = "ABCDE"[index]; return <div key={letter} className="rounded-xl border border-border p-3"><div className="mb-1 flex items-center gap-2 text-xs font-bold">{letter}. {letter === question.correctOption && <Badge className="rounded-full">Jawaban benar</Badge>}</div><Part part={option} label={`Gambar pilihan ${letter} soal ${question.number}`} /></div>; })}</div></li>)}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 text-xs text-muted-foreground sm:px-6"><span>Halaman {page + 1} dari {pages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={Boolean(busy) || page === 0} onClick={() => setPage((x) => x - 1)}>Sebelumnya</Button><Button size="sm" variant="outline" disabled={Boolean(busy) || page + 1 >= pages} onClick={() => setPage((x) => x + 1)}>Berikutnya</Button></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-4 sm:px-6"><p className="max-w-xl text-[11px] leading-5 text-muted-foreground">Semua soal disimpan sekaligus. Jika hasil belum pasti, jangan muat ulang atau ganti file/kategori; coba simpan lagi pratinjau yang sama. Pratinjau baru dapat membuat duplikat.</p><Button type="button" disabled={Boolean(busy)} onClick={() => setConfirmOpen(true)} className="h-10 rounded-xl font-semibold">Simpan hasil impor</Button></div>
    </Card>}
    <Dialog open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md" showCloseButton={!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle className="text-lg font-bold">Simpan hasil impor?</DialogTitle><DialogDescription>Tambahkan {preview?.questions.length ?? 0} soal ke kategori <strong className="text-foreground">{preview?.topicName}</strong>. Soal lama tidak ditimpa.</DialogDescription></DialogHeader><p className="text-xs leading-5 text-muted-foreground">Pastikan Anda sudah memeriksa soal dan kuncinya. Impor ulang dengan pratinjau baru dapat membuat soal ganda.</p><DialogFooter><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => setConfirmOpen(false)}>Batal</Button><Button type="button" disabled={Boolean(busy)} onClick={handleSave}>{busy === "save" && <Spinner aria-hidden="true" />}{busy === "save" ? "Menyimpan..." : "Ya, simpan impor"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
