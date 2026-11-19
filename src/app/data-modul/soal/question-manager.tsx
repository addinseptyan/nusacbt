"use client";

import { useState, useTransition, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpenCheck, ChevronLeft, ChevronRight, Eye, ImageIcon, Info, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteQuestion, saveQuestion } from "@/app/data-modul/soal/actions";
import { QuestionRichDisplay } from "@/components/question-rich-display";
import { QuestionRichEditor } from "@/components/question-rich-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { QUESTION_IMAGE_SLOTS, QUESTION_LETTERS, type Question, type QuestionImageSlot, type QuestionTopicOption } from "@/lib/question-types";

const PAGE_SIZE = 10;
// Pemeriksaan awal untuk pengalaman pengguna; server tetap memverifikasi ulang.
const IMAGE_MAX_BYTES = 1024 * 1024;
const dialogClass = "max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-3xl";
const selectClass = "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";
type QuestionError = { message: string; reload?: boolean } | null;

function ErrorNotice({ error, onReload }: { error: NonNullable<QuestionError>; onReload: () => void }) {
  return <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription><span>{error.message}</span>{error.reload && <Button type="button" variant="outline" size="sm" className="mt-3 block" onClick={onReload}>Muat ulang daftar</Button>}</AlertDescription></Alert>;
}

function QuestionImage({ question, slot, alt }: { question: Question; slot: QuestionImageSlot; alt: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = `/api/admin/soal/${question.id}/${slot}?versi=${encodeURIComponent(question.revision)}`;
  if (failedSrc === src) return <p role="status" className="mt-2 text-xs leading-5 text-destructive">Gambar tidak dapat dimuat atau soal telah berubah. Tutup dialog dan muat ulang daftar.</p>;
  return <Image src={src} unoptimized width={360} height={220} alt={alt} onError={() => setFailedSrc(src)} className="mt-2 h-auto max-h-44 w-auto max-w-full rounded-lg border border-border object-contain" />;
}

function ImageField({ question, slot, hasImage, disabled }: { question: Question | null; slot: QuestionImageSlot; hasImage: boolean; disabled: boolean }) {
  const label = slot === "prompt" ? "Gambar soal" : `Gambar pilihan ${slot}`;
  const id = `image-${slot}`;
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border bg-muted/20 p-3">
      <label htmlFor={id} className="flex items-center gap-2 text-[12px] font-semibold"><ImageIcon className="size-4" /> {label}</label>
      {question && hasImage && <QuestionImage question={question} slot={slot} alt={`${label} yang tersimpan`} />}
      <Input id={id} type="file" name={`image_${slot}`} accept="image/png,image/jpeg" disabled={disabled} className="h-auto max-w-full py-2 text-xs" />
      <p className="text-[11px] leading-5 text-muted-foreground">PNG/JPEG, maksimal 1 MiB sebelum dan sesudah diproses. {hasImage ? "Pilih file baru untuk mengganti; gambar baru tampil setelah disimpan." : "Gambar baru tampil setelah disimpan."}</p>
      {hasImage && <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" name={`remove_${slot}`} value="1" disabled={disabled} className="accent-primary" /> Hapus gambar tersimpan</label>}
    </div>
  );
}

function QuestionEditor({ question, topics, open, onOpenChange }: { question: Question | null; topics: QuestionTopicOption[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [error, setError] = useState<QuestionError>(null);
  const [pending, startTransition] = useTransition();

  function changeOpen(next: boolean) {
    if (pending) return;
    if (!next) setError(null);
    onOpenChange(next);
  }
  function reload() { setError(null); onOpenChange(false); router.refresh(); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    // Field file yang tidak dipilih harus dihapus sebelum serialisasi Server Action;
    // beberapa runtime memberi nama "blob" pada File kosong setelah transport.
    for (const slot of QUESTION_IMAGE_SLOTS) {
      const value = data.get(`image_${slot}`);
      if (!(value instanceof File)) continue;
      if (value.size === 0 && value.name === "") { data.delete(`image_${slot}`); continue; }
      if (value.size === 0 || value.size > IMAGE_MAX_BYTES) {
        const label = slot === "prompt" ? "Gambar soal" : `Gambar pilihan ${slot}`;
        setError({ message: `${label}: ukuran harus 1 byte sampai 1 MiB.` });
        return;
      }
    }
    if (question) { data.set("id", question.id); data.set("revision", question.revision); }
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveQuestion(data);
        if (!result.ok) return setError({ message: result.error, reload: result.reload });
        onOpenChange(false);
        toast.success(result.message);
        router.refresh();
      } catch {
        setError({ message: "Hasil penyimpanan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar sebelum mencoba lagi.", reload: true });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{question ? "Ubah soal" : "Tambah soal"}</DialogTitle>
          <DialogDescription>Pilih satu kategori, isi soal dan lima pilihan, lalu tandai tepat satu jawaban benar. Setiap bagian boleh berupa teks, satu gambar, atau keduanya. Perubahan baru tersimpan setelah tombol Simpan soal berhasil.</DialogDescription>
        </DialogHeader>
        <form key={`${question?.id ?? "baru"}-${open}`} onSubmit={submit} className="space-y-5 pt-1">
          <p className="text-[11px] leading-5 text-muted-foreground">Untuk rumus Word, aktifkan “Copy MathML to the clipboard as plain text”, lalu salin satu Equation dan tempel pada posisi kursor. Salin teks/tabel terpisah dari rumus. Word 2013 belum diuji langsung.</p>
          <div className="space-y-2">
            <label htmlFor="question-topic" className="text-sm font-semibold">Topik / mata pelajaran <span className="text-destructive">*</span></label>
            <select id="question-topic" name="topicId" required disabled={pending} defaultValue={question?.topicId ?? ""} className={selectClass}>
              <option value="">Pilih satu kategori</option>
              {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="question-prompt" className="text-sm font-semibold">Isi soal</label>
            <QuestionRichEditor id="question-prompt" field="prompt" label="Isi soal" initialText={question?.prompt ?? ""} initialDocument={question?.promptRich ?? null} disabled={pending} />
            <p className="text-[11px] text-muted-foreground">Maksimal 5.000 karakter. Gunakan RTL untuk paragraf Arab. Periksa format dan rumus yang ditempel sebelum menyimpan.</p>
            <ImageField question={question} slot="prompt" hasImage={Boolean(question?.hasPromptImage)} disabled={pending} />
          </div>
          <fieldset className="space-y-3" disabled={pending}>
            <legend className="text-sm font-bold">Pilihan jawaban A–E</legend>
            <p className="text-[12px] leading-5 text-muted-foreground">Setiap pilihan harus memiliki teks atau gambar. Tandai tepat satu jawaban benar.</p>
            {QUESTION_LETTERS.map((letter) => {
              const option = question?.options.find((item) => item.letter === letter);
              return (
                <div key={letter} className="space-y-3 rounded-2xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={`option-${letter}`} className="text-sm font-bold">Pilihan {letter}</label><label className="flex items-center gap-2 text-[12px] font-semibold"><input type="radio" name="correctOption" value={letter} defaultChecked={question?.correctOption === letter} required className="accent-primary" /> Jawaban {letter} benar</label></div>
                  <QuestionRichEditor id={`option-${letter}`} field={`option_${letter}`} label={`Pilihan ${letter}`} initialText={option?.text ?? ""} initialDocument={option?.rich ?? null} disabled={pending} />
                  <ImageField question={question} slot={letter} hasImage={Boolean(option?.hasImage)} disabled={pending} />
                </div>
              );
            })}
          </fieldset>
          <p className="text-[11px] leading-5 text-muted-foreground">Teks pilihan maksimal 2.000 karakter. Periksa setiap rumus yang ditempel; bentuk yang tidak didukung ditolak. Gambar tetap diunggah lewat file.</p>
          {error && <ErrorNotice error={error} onReload={reload} />}
          <DialogFooter className="mt-5 -mx-4 -mb-4 rounded-b-2xl">
            <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>Batal</Button>
            <Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan soal"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QuestionDetail({ question, onClose }: { question: Question | null; onClose: () => void }) {
  return (
    <Dialog open={question !== null} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className={dialogClass}>
        <DialogHeader><DialogTitle className="text-lg font-bold">Detail soal</DialogTitle><DialogDescription>Kunci jawaban hanya untuk admin. Soal dapat dipilih pada rancangan tes; pengerjaan dan login peserta belum tersedia.</DialogDescription></DialogHeader>
        {question && <div className="space-y-5 py-1">
          <Badge variant="secondary" className="max-w-full break-words">{question.topicName}</Badge>
          <div><h3 className="text-sm font-bold">Isi soal</h3><div className="mt-2 text-sm"><QuestionRichDisplay document={question.promptRich} fallback={question.prompt} /></div>{question.hasPromptImage && <QuestionImage question={question} slot="prompt" alt="Gambar soal" />}</div>
          <div className="space-y-2"><h3 className="text-sm font-bold">Pilihan jawaban</h3>{question.options.map((option) => <div key={option.letter} className="rounded-xl border border-border p-3"><div className="flex items-center gap-2"><span className="text-sm font-bold">{option.letter}.</span>{option.letter === question.correctOption && <Badge className="rounded-full">Jawaban benar</Badge>}</div><div className="mt-1 text-sm"><QuestionRichDisplay document={option.rich} fallback={option.text} /></div>{option.hasImage && <QuestionImage question={question} slot={option.letter} alt={`Gambar pilihan ${option.letter}`} />}</div>)}</div>
        </div>}
        <DialogFooter className="rounded-b-2xl"><Button type="button" variant="outline" onClick={onClose}>Tutup</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteQuestionDialog({ question, onClose }: { question: Question | null; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<QuestionError>(null);
  const [pending, startTransition] = useTransition();
  function close() { if (!pending) { setError(null); onClose(); } }
  function reload() { setError(null); onClose(); router.refresh(); }
  function remove() {
    if (!question) return;
    const data = new FormData(); data.set("id", question.id); data.set("revision", question.revision);
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteQuestion(data);
        if (!result.ok) return setError({ message: result.error, reload: result.reload });
        onClose(); toast.success(result.message); router.refresh();
      } catch { setError({ message: "Hasil penghapusan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar sebelum mencoba lagi.", reload: true }); }
    });
  }
  return (
    <Dialog open={question !== null} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md" showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader><DialogTitle className="text-lg font-bold">Hapus soal?</DialogTitle><DialogDescription>Soal <strong className="break-words text-foreground">#{question?.id}</strong> beserta gambar yang tersimpan akan dihapus permanen. Jika masih direferensikan, penghapusan ditolak.</DialogDescription></DialogHeader>
        {error && <ErrorNotice error={error} onReload={reload} />}
        <DialogFooter className="rounded-b-2xl"><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="button" variant="destructive" disabled={pending} onClick={remove}>{pending ? "Menghapus..." : "Ya, hapus soal"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QuestionManager({ topics, questions }: { topics: QuestionTopicOption[]; questions: Question[] }) {
  const [query, setQuery] = useState("");
  const [topicId, setTopicId] = useState("");
  const [page, setPage] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [viewing, setViewing] = useState<Question | null>(null);
  const [deleting, setDeleting] = useState<Question | null>(null);
  const normalized = query.trim().toLowerCase();
  const filtered = questions.filter((question) => (!topicId || question.topicId === topicId) && (!normalized || [question.prompt, question.topicName, ...question.options.map((option) => option.text)].some((text) => text.toLowerCase().includes(normalized))));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  function openEditor(question: Question | null) { setEditing(question); setEditorOpen(true); }

  return (
    <>
      <Alert className="mb-6 max-w-4xl rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200">
        <Info className="size-4 text-[#727fc8] dark:text-indigo-300" /><AlertTitle className="text-[12px] font-bold">Bank soal</AlertTitle><AlertDescription className="mt-0.5 text-[12px] leading-5 text-[#6873a0] dark:text-indigo-200/70">Satu kategori, lima pilihan A–E, dan satu jawaban benar. <Link href="/data-modul/import-soal" className="font-semibold underline">Impor Word</Link> tersedia untuk format yang didukung; ekspor Word dan pengerjaan tes belum tersedia.</AlertDescription>
      </Alert>
      {topics.length === 0 && <Alert className="mb-6 max-w-4xl rounded-2xl"><Info className="size-4" /><AlertTitle>Siapkan kategori terlebih dahulu</AlertTitle><AlertDescription>Buka <Link href="/data-modul/topik">Topik / Mata Pelajaran</Link> untuk menambah kategori sebelum membuat soal.</AlertDescription></Alert>}
      <Card className="max-w-5xl gap-0 overflow-hidden rounded-[18px] bg-card py-0 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5 sm:px-6">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2.5"><h2 className="text-[15px] font-bold">Daftar soal</h2><Badge variant="secondary" className="rounded-full text-[10px]">{questions.length} soal</Badge></div><p className="mt-1 text-[12px] text-muted-foreground">Kelola soal pilihan ganda untuk digunakan pada tahap tes mendatang.</p></div>
          <Button onClick={() => openEditor(null)} disabled={topics.length === 0} className="h-10 rounded-xl px-4 font-semibold"><Plus className="size-4" /> Tambah soal</Button>
        </div>
        <div className="grid gap-4 border-b border-border px-5 py-4 sm:grid-cols-2 sm:px-6">
          <div><label htmlFor="question-search" className="mb-2 block text-[12px] font-semibold">Cari soal</label><div className="relative"><Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" /><Input id="question-search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Cari teks soal atau pilihan" className="h-11 rounded-xl pl-9" /></div></div>
          <div><label htmlFor="question-filter-topic" className="mb-2 block text-[12px] font-semibold">Filter kategori</label><select id="question-filter-topic" value={topicId} onChange={(event) => { setTopicId(event.target.value); setPage(0); }} className={selectClass}><option value="">Semua kategori</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></div>
          {(query || topicId) && <p aria-live="polite" className="text-[11px] text-muted-foreground sm:col-span-2">{filtered.length} soal ditemukan</p>}
        </div>
        {visible.length === 0 ? <div className="flex flex-col items-center px-6 py-12 text-center"><BookOpenCheck className="size-7 text-muted-foreground" /><h3 className="mt-4 text-sm font-bold">{questions.length === 0 ? "Belum ada soal" : "Soal tidak ditemukan"}</h3><p className="mt-1.5 text-[12px] leading-6 text-muted-foreground">{questions.length === 0 ? "Tambahkan soal pilihan ganda pertama." : "Coba kata kunci atau kategori lain."}</p></div> : (
          <ul aria-label="Daftar soal" className="divide-y divide-border">
            {visible.map((question) => <li key={question.id} className="flex min-w-0 flex-col gap-3 p-5 sm:flex-row sm:items-start sm:gap-5 sm:px-6">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="max-w-full break-words">{question.topicName}</Badge><span className="text-[11px] text-muted-foreground">Soal #{question.id}</span>{question.hasPromptImage && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><ImageIcon className="size-3.5" /> Bergambar</span>}</div><p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-[13px] leading-6 font-semibold">{question.prompt || "Soal bergambar tanpa teks"}</p><p className="mt-1 text-[11px] text-muted-foreground">Kunci: {question.correctOption}</p></div>
              <div className="flex shrink-0 flex-wrap gap-2"><Button variant="outline" size="sm" aria-label={`Lihat soal ${question.id}`} onClick={() => setViewing(question)} className="rounded-lg"><Eye className="size-3.5" /> Lihat</Button><Button variant="outline" size="sm" aria-label={`Ubah soal ${question.id}`} onClick={() => openEditor(question)} className="rounded-lg"><Pencil className="size-3.5" /> Ubah</Button><Button variant="outline" size="sm" aria-label={`Hapus soal ${question.id}`} onClick={() => setDeleting(question)} className="rounded-lg text-destructive hover:text-destructive"><Trash2 className="size-3.5" /> Hapus</Button></div>
            </li>)}
          </ul>
        )}
        {pages > 1 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 text-[12px] text-muted-foreground sm:px-6"><span>Halaman {currentPage + 1} dari {pages} · {filtered.length} soal</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label="Halaman sebelumnya"><ChevronLeft className="size-4" /> Sebelumnya</Button><Button variant="outline" size="sm" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)} aria-label="Halaman berikutnya">Berikutnya <ChevronRight className="size-4" /></Button></div></div>}
      </Card>
      <QuestionEditor question={editing} topics={topics} open={editorOpen} onOpenChange={setEditorOpen} />
      <QuestionDetail question={viewing} onClose={() => setViewing(null)} />
      <DeleteQuestionDialog question={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}
