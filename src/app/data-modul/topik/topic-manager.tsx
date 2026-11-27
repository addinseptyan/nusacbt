"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, BookOpenText, ChevronLeft, ChevronRight, Info, Pencil, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { deleteTopic, saveTopic } from "@/app/data-modul/topik/actions";
import { useCanDevCascadeDelete } from "@/components/admin-user-context";
import { DevCascadeDeleteDialog } from "@/components/dev-cascade-delete-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { QuestionTopic } from "@/lib/topic-types";
import { formatTopicLabel, matchesMultiKeyword, validateTopicTags } from "@/lib/topic-validation.mjs";

const dialogClass = "max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg";
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

function TopicEditor({
  topic,
  open,
  onOpenChange,
  allExistingTags,
}: {
  topic: QuestionTopic | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allExistingTags: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<TopicError>(null);
  const [pending, startTransition] = useTransition();
  const [tags, setTags] = useState<string[]>(() => topic?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) {
      setError(null);
      setTagDraft("");
    }
    onOpenChange(next);
  }

  function reload() {
    setError(null);
    onOpenChange(false);
    router.refresh();
  }

  function addDraftTags(rawText: string) {
    const merged = validateTopicTags([...tags, ...rawText.split(",")]);
    if (!merged.ok) {
      setError({ message: merged.error });
      return false;
    }
    setTags(merged.value);
    setTagDraft("");
    setError(null);
    return true;
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (tagDraft.trim()) addDraftTags(tagDraft);
    } else if (event.key === "Backspace" && !tagDraft && tags.length > 0) {
      setTags((current) => current.slice(0, -1));
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pendingTagText = tagDraft.trim();
    const combinedTags = pendingTagText ? validateTopicTags([...tags, ...pendingTagText.split(",")]) : validateTopicTags(tags);
    if (!combinedTags.ok) {
      setError({ message: combinedTags.error });
      return;
    }
    const data = new FormData(event.currentTarget);
    data.set("tags", combinedTags.value.join(", "));
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

  const unusedSuggestions = allExistingTags.filter(
    (suggestion) => !tags.some((existing) => existing.toLowerCase() === suggestion.toLowerCase()),
  ).slice(0, 8);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{topic ? "Ubah mata pelajaran" : "Tambah mata pelajaran"}</DialogTitle>
          <DialogDescription>
            {topic
              ? "Perubahan nama atau tag berlaku pada mata pelajaran ini."
              : "Masukkan nama mata pelajaran ringkas (misalnya Matematika) dan tambahkan tag opsional sebagai pembeda (misalnya Kelas X, Ganjil)."}
          </DialogDescription>
        </DialogHeader>
        <form key={`${topic?.id ?? "baru"}-${open}`} onSubmit={handleSubmit} className="space-y-4 pt-2">
          {error && <ErrorNotice error={error} onReload={reload} />}
          <div className="space-y-2">
            <label htmlFor="topic-name" className="text-sm font-semibold">Nama mata pelajaran <span className="text-destructive">*</span></label>
            <Input id="topic-name" name="name" maxLength={256} defaultValue={topic?.name ?? ""} placeholder="Contoh: Matematika" required disabled={pending} className="h-11 rounded-xl" />
            <p className="text-[11px] leading-5 text-muted-foreground">Maksimal 100 karakter. Nama yang sama boleh digunakan lagi selama memiliki kombinasi tag berbeda.</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="topic-tag-input" className="flex items-center gap-1.5 text-sm font-semibold">
              <Tag className="size-3.5 text-primary" /> Tag pengelompokan (opsional)
            </label>
            <div className="flex gap-2">
              <Input
                id="topic-tag-input"
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={handleTagKeyDown}
                maxLength={60}
                disabled={pending || tags.length >= 10}
                placeholder="Ketik tag lalu tekan Enter (misal: Kelas X)"
                className="h-10 rounded-xl"
              />
              <Button
                type="button"
                variant="outline"
                disabled={pending || !tagDraft.trim() || tags.length >= 10}
                onClick={() => addDraftTags(tagDraft)}
                className="h-10 shrink-0 rounded-xl"
              >
                Tambah tag
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1" aria-label="Tag terpilih">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1 rounded-full py-1 pl-2.5 pr-1.5 text-xs">
                    <span>{tag}</span>
                    <button
                      type="button"
                      disabled={pending}
                      aria-label={`Hapus tag ${tag}`}
                      onClick={() => setTags((current) => current.filter((item) => item !== tag))}
                      className="rounded-full p-0.5 hover:bg-muted"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            {unusedSuggestions.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-[11px] text-muted-foreground">Klik tag yang sudah ada untuk memakai ulang:</p>
                <div className="flex flex-wrap gap-1.5">
                  {unusedSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={pending || tags.length >= 10}
                      onClick={() => addDraftTags(suggestion)}
                      className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition hover:border-primary hover:text-primary"
                    >
                      + {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="text-[11px] leading-5 text-muted-foreground">Maksimal 10 tag per kategori (maksimal 30 karakter per tag).</p>
          </div>

          <DialogFooter className="mt-5 -mx-4 -mb-4 rounded-b-2xl">
            <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>Batal</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner aria-hidden="true" />}
              {pending ? "Menyimpan..." : "Simpan mata pelajaran"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTopicDialog({
  topic,
  onClose,
  onRequestCascade,
}: {
  topic: QuestionTopic | null;
  onClose: () => void;
  onRequestCascade: (topic: QuestionTopic) => void;
}) {
  const router = useRouter();
  const canDevCascade = useCanDevCascadeDelete();
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
          <DialogTitle className="text-lg font-bold">Hapus mata pelajaran?</DialogTitle>
          <DialogDescription>
            <strong className="break-words text-foreground">{topic ? formatTopicLabel(topic) : ""}</strong> akan dihapus permanen. Jika masih digunakan oleh data lain, penghapusan standar ditolak.
          </DialogDescription>
        </DialogHeader>
        {error && <ErrorNotice error={error} onReload={reload} />}
        <DialogFooter className="flex-wrap gap-2 rounded-b-2xl">
          <Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button>
          {canDevCascade && topic && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                const target = topic;
                close();
                onRequestCascade(target);
              }}
              className="border-amber-400 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"
            >
              Hapus beserta dependensi (Mode Dev)
            </Button>
          )}
          <Button type="button" variant="destructive" disabled={pending} onClick={handleDelete}>
            {pending && <Spinner aria-hidden="true" />}
            {pending ? "Menghapus..." : "Ya, hapus mata pelajaran"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TopicManager({
  topics,
  canManageTopics = true,
  canManageQuestions = true,
}: {
  topics: QuestionTopic[];
  canManageTopics?: boolean;
  canManageQuestions?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [page, setPage] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<QuestionTopic | null>(null);
  const [deleting, setDeleting] = useState<QuestionTopic | null>(null);
  const [cascadeTarget, setCascadeTarget] = useState<QuestionTopic | null>(null);

  const allTags = useMemo(() => {
    const map = new Map<string, string>();
    for (const topic of topics) {
      for (const tag of topic.tags ?? []) {
        const key = tag.toLowerCase();
        if (!map.has(key)) map.set(key, tag);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, "id"));
  }, [topics]);

  const normalizedTag = tagFilter.trim().toLowerCase();
  const filtered = topics.filter((topic) => {
    const matchesTag = !normalizedTag || (topic.tags ?? []).some((tag) => tag.toLowerCase() === normalizedTag);
    const matchesQuery = matchesMultiKeyword(query, [topic.name, ...(topic.tags ?? [])]);
    return matchesTag && matchesQuery;
  });
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
        <AlertTitle className="text-[12px] font-bold">Satu alur Mata Pelajaran &amp; Bank Soal</AlertTitle>
        <AlertDescription className="mt-0.5 text-[12px] leading-5 text-[#6873a0] dark:text-indigo-200/70">
          Gunakan nama mata pelajaran yang ringkas (misalnya <em>Matematika</em>) dan tambahkan tag (misalnya <em>Kelas X</em>, <em>Ganjil</em>). Klik <strong>Kelola soal</strong> pada mata pelajaran tertentu untuk langsung membuka bank soal yang terfilter.
        </AlertDescription>
      </Alert>

      <Card className="max-w-5xl gap-0 overflow-hidden rounded-[18px] bg-card py-0 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-[15px] font-bold">Daftar mata pelajaran</h2>
              <Badge variant="secondary" className="rounded-full text-[10px]">{topics.length} mata pelajaran</Badge>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">Contoh: Matematika dengan tag Kelas X, IPA dengan tag Semester 1.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageQuestions && (
              <Button asChild variant="outline" className="h-10 rounded-xl px-4 font-semibold">
                <Link href="/data-modul/soal" prefetch={false}>
                  <BookOpenCheck className="size-4" /> Semua Bank Soal
                </Link>
              </Button>
            )}
            {canManageTopics && (
              <Button onClick={() => openEditor(null)} className="h-10 rounded-xl px-4 font-semibold"><Plus className="size-4" /> Tambah mata pelajaran</Button>
            )}
          </div>
        </div>
        <div className="space-y-3 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <label htmlFor="topic-search" className="mb-2 block text-[12px] font-semibold">Cari mata pelajaran atau tag</label>
            <div className="relative max-w-md"><Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" /><Input id="topic-search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Cari nama atau tag (multi kata, mis. matematika kelas x)" className="h-11 rounded-xl pl-9" /></div>
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Filter menurut tag">
              <span className="mr-1 text-[11px] font-semibold text-muted-foreground">Filter tag:</span>
              <button
                type="button"
                onClick={() => { setTagFilter(""); setPage(0); }}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${!tagFilter ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
              >
                Semua
              </button>
              {allTags.map((tag) => {
                const active = tagFilter.toLowerCase() === tag.toLowerCase();
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => { setTagFilter(active ? "" : tag); setPage(0); }}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          )}
          {(query || tagFilter) && <p aria-live="polite" className="text-[11px] text-muted-foreground">{filtered.length} mata pelajaran ditemukan</p>}
        </div>
        {visible.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center"><BookOpenText className="size-7 text-muted-foreground" /><h3 className="mt-4 text-sm font-bold">{topics.length === 0 ? "Belum ada mata pelajaran" : "Mata pelajaran tidak ditemukan"}</h3><p className="mt-1.5 text-[12px] leading-6 text-muted-foreground">{topics.length === 0 ? "Tambahkan mata pelajaran pertama." : "Coba kata kunci atau filter tag lain."}</p></div>
        ) : (
          <ul aria-label="Daftar mata pelajaran" className="divide-y divide-border">
            {visible.map((topic) => (
              <li key={topic.id} className="flex min-w-0 flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-5 sm:px-6">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"><BookOpenText className="size-[18px]" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 break-words text-[13px] font-bold">{topic.name}</h3>
                      <Badge variant="secondary" className="rounded-full text-[10px] tabular-nums">{topic.questionCount ?? 0} soal</Badge>
                    </div>
                    {topic.tags && topic.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {topic.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="rounded-full text-[10px] font-medium">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {canManageQuestions && (
                    <Button asChild variant="default" size="sm" className="rounded-lg">
                      <Link href={`/data-modul/soal?topik=${topic.id}`} prefetch={false} aria-label={`Kelola soal ${topic.name}`}>
                        <BookOpenCheck className="size-3.5" /> Kelola soal
                      </Link>
                    </Button>
                  )}
                  {canManageTopics && (
                    <>
                      <Button variant="outline" size="sm" aria-label={`Ubah mata pelajaran ${topic.name}`} onClick={() => openEditor(topic)} className="rounded-lg"><Pencil className="size-3.5" /> Ubah</Button>
                      <Button variant="outline" size="sm" aria-label={`Hapus mata pelajaran ${topic.name}`} onClick={() => setDeleting(topic)} className="rounded-lg text-destructive hover:text-destructive"><Trash2 className="size-3.5" /> Hapus</Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 text-[12px] text-muted-foreground sm:px-6"><span>Halaman {currentPage + 1} dari {pages} · {filtered.length} mata pelajaran</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label="Halaman sebelumnya"><ChevronLeft className="size-4" /> Sebelumnya</Button><Button variant="outline" size="sm" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)} aria-label="Halaman berikutnya">Berikutnya <ChevronRight className="size-4" /></Button></div></div>}
      </Card>
      <TopicEditor key={`${editing?.id ?? "new"}-${editorOpen}`} topic={editing} open={editorOpen} onOpenChange={setEditorOpen} allExistingTags={allTags} />
      <DeleteTopicDialog topic={deleting} onClose={() => setDeleting(null)} onRequestCascade={(item) => setCascadeTarget(item)} />
      <DevCascadeDeleteDialog
        open={cascadeTarget !== null}
        onOpenChange={(open) => { if (!open) setCascadeTarget(null); }}
        entityType="topic"
        entityId={cascadeTarget?.id ?? null}
        entityTitle={cascadeTarget ? formatTopicLabel(cascadeTarget) : ""}
      />
    </>
  );
}
