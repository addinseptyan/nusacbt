"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, ChevronLeft, ChevronRight, Info, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteTopic, saveTopic } from "@/app/data-modul/topik/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { QuestionTopic } from "@/lib/topic-types";

const dialogClass = "max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md";
const PAGE_SIZE = 12;

type TopicError = { message: string; reload?: boolean } | null;

function ErrorNotice({ error, onReload }: { error: NonNullable<TopicError>; onReload: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <Info className="size-4" />
      <AlertDescription>
        <span>{error.message}</span>
        {error.reload && <Button type="button" variant="outline" size="sm" className="mt-3 block" onClick={onReload}>Muat ulang daftar</Button>}
      </AlertDescription>
    </Alert>
  );
}

function TopicEditor({ topic, open, onOpenChange }: { topic: QuestionTopic | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [error, setError] = useState<TopicError>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) setError(null);
    onOpenChange(next);
  }

  function reload() {
    setError(null);
    onOpenChange(false);
    router.refresh();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (topic) { data.set("id", topic.id); data.set("revision", topic.revision); }
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveTopic(data);
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{topic ? "Ubah topik / mata pelajaran" : "Tambah topik / mata pelajaran"}</DialogTitle>
          <DialogDescription>{topic ? "Perubahan berlaku pada kategori ini, bukan membuat kategori baru." : "Masukkan nama mata pelajaran atau topik sebagai kategori satu tingkat."}</DialogDescription>
        </DialogHeader>
        <form key={`${topic?.id ?? "baru"}-${open}`} onSubmit={handleSubmit} className="space-y-4 pt-2">
          {error && <ErrorNotice error={error} onReload={reload} />}
          <div className="space-y-2">
            <label htmlFor="topic-name" className="text-sm font-semibold">Nama topik / mata pelajaran <span className="text-destructive">*</span></label>
            <Input id="topic-name" name="name" maxLength={256} defaultValue={topic?.name ?? ""} placeholder="Contoh: Matematika" required disabled={pending} className="h-11 rounded-xl" />
            <p className="text-[11px] leading-5 text-muted-foreground">Maksimal 100 karakter. Spasi di awal dan akhir dibersihkan; nama yang sama tidak boleh berbeda hanya kapitalisasi.</p>
          </div>
          <DialogFooter className="mt-5 -mx-4 -mb-4 rounded-b-2xl">
            <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>Batal</Button>
            <Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan topik"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTopicDialog({ topic, onClose }: { topic: QuestionTopic | null; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<TopicError>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setError(null);
    onClose();
  }

  function reload() {
    setError(null);
    onClose();
    router.refresh();
  }

  function handleDelete() {
    if (!topic) return;
    const data = new FormData();
    data.set("id", topic.id);
    data.set("revision", topic.revision);
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteTopic(data);
        if (!result.ok) return setError({ message: result.error, reload: result.reload });
        onClose();
        toast.success(result.message);
        router.refresh();
      } catch {
        setError({ message: "Hasil penghapusan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar sebelum mencoba lagi.", reload: true });
      }
    });
  }

  return (
    <Dialog open={topic !== null} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Hapus topik?</DialogTitle>
          <DialogDescription><strong className="break-words text-foreground">{topic?.name}</strong> akan dihapus permanen. Jika masih digunakan oleh data lain, penghapusan ditolak.</DialogDescription>
        </DialogHeader>
        {error && <ErrorNotice error={error} onReload={reload} />}
        <DialogFooter className="rounded-b-2xl">
          <Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={handleDelete}>{pending ? "Menghapus..." : "Ya, hapus topik"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TopicManager({ topics }: { topics: QuestionTopic[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<QuestionTopic | null>(null);
  const [deleting, setDeleting] = useState<QuestionTopic | null>(null);
  const normalized = query.trim().toLowerCase();
  const filtered = topics.filter((topic) => !normalized || topic.name.toLowerCase().includes(normalized));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  function openEditor(topic: QuestionTopic | null) {
    setEditing(topic);
    setEditorOpen(true);
  }

  return (
    <>
      <Alert className="mb-6 max-w-4xl rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200">
        <Info className="size-4 text-[#727fc8] dark:text-indigo-300" />
        <AlertTitle className="text-[12px] font-bold">Satu daftar fleksibel</AlertTitle>
        <AlertDescription className="mt-0.5 text-[12px] leading-5 text-[#6873a0] dark:text-indigo-200/70">Mata pelajaran dan topik berada dalam daftar yang sama, tanpa subtopik, dan digunakan lintas periode. Soal serta impor Word belum tersedia pada tahap ini.</AlertDescription>
      </Alert>

      <Card className="max-w-5xl gap-0 overflow-hidden rounded-[18px] bg-card py-0 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5 sm:px-6">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2.5"><h2 className="text-[15px] font-bold">Daftar topik / mata pelajaran</h2><Badge variant="secondary" className="rounded-full text-[10px]">{topics.length} kategori</Badge></div><p className="mt-1 text-[12px] text-muted-foreground">Contoh: Matematika, Bahasa Indonesia, atau Aljabar.</p></div>
          <Button onClick={() => openEditor(null)} className="h-10 rounded-xl px-4 font-semibold"><Plus className="size-4" /> Tambah topik</Button>
        </div>
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <label htmlFor="topic-search" className="mb-2 block text-[12px] font-semibold">Cari topik atau mata pelajaran</label>
          <div className="relative max-w-md"><Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" /><Input id="topic-search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Cari nama kategori" className="h-11 rounded-xl pl-9" /></div>
          {query && <p aria-live="polite" className="mt-2 text-[11px] text-muted-foreground">{filtered.length} kategori ditemukan</p>}
        </div>
        {visible.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center"><BookOpenText className="size-7 text-muted-foreground" /><h3 className="mt-4 text-sm font-bold">{topics.length === 0 ? "Belum ada topik" : "Topik tidak ditemukan"}</h3><p className="mt-1.5 text-[12px] leading-6 text-muted-foreground">{topics.length === 0 ? "Tambahkan mata pelajaran atau topik pertama." : "Coba kata kunci lain."}</p></div>
        ) : (
          <ul aria-label="Daftar topik dan mata pelajaran" className="divide-y divide-border">
            {visible.map((topic) => (
              <li key={topic.id} className="flex min-w-0 flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-5 sm:px-6">
                <div className="flex min-w-0 flex-1 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"><BookOpenText className="size-[18px]" /></span><h3 className="min-w-0 break-words text-[13px] font-bold">{topic.name}</h3></div>
                <div className="flex shrink-0 flex-wrap gap-2"><Button variant="outline" size="sm" aria-label={`Ubah topik ${topic.name}`} onClick={() => openEditor(topic)} className="rounded-lg"><Pencil className="size-3.5" /> Ubah</Button><Button variant="outline" size="sm" aria-label={`Hapus topik ${topic.name}`} onClick={() => setDeleting(topic)} className="rounded-lg text-destructive hover:text-destructive"><Trash2 className="size-3.5" /> Hapus</Button></div>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 text-[12px] text-muted-foreground sm:px-6"><span>Halaman {currentPage + 1} dari {pages} · {filtered.length} kategori</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label="Halaman sebelumnya"><ChevronLeft className="size-4" /> Sebelumnya</Button><Button variant="outline" size="sm" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)} aria-label="Halaman berikutnya">Berikutnya <ChevronRight className="size-4" /></Button></div></div>}
      </Card>
      <TopicEditor topic={editing} open={editorOpen} onOpenChange={setEditorOpen} />
      <DeleteTopicDialog topic={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}
