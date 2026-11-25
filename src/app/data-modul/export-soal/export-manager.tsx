"use client";

import { CheckSquare, CircleAlert, Download, FileText, Image as ImageIcon, Info, Search, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SearchableCombobox, type ComboboxOption } from "@/components/searchable-combobox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { QuestionLetter, QuestionTopicOption } from "@/lib/question-types";
import { formatTopicLabel } from "@/lib/topic-validation.mjs";

export type ExportQuestionSummary = {
  id: string;
  topicId: string;
  topicName: string;
  topicTags?: string[];
  promptPreview: string;
  hasPromptImage: boolean;
  optionImageCount: number;
  correctOption: QuestionLetter;
};

const MAX_EXPORT_PER_FILE = 100;
const inputClass = "h-10 w-full rounded-xl border border-input bg-background px-3 text-sm";

export function ExportWordManager({
  topics,
  questions,
  initialTopicId,
  initialSearch,
}: {
  topics: QuestionTopicOption[];
  questions: ExportQuestionSummary[];
  initialTopicId: string;
  initialSearch: string;
}) {
  const router = useRouter();
  const [filterTopicId, setFilterTopicId] = useState(initialTopicId);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    questions.slice(0, MAX_EXPORT_PER_FILE).map((q) => q.id),
  );
  const [includeKeys, setIncludeKeys] = useState(true);
  const [title, setTitle] = useState(() => {
    const topic = topics.find((t) => t.id === initialTopicId);
    return topic ? `Soal ${formatTopicLabel(topic)}` : "Daftar Soal NusaCBT";
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const topicOptions = useMemo<ComboboxOption[]>(
    () => topics.map((t) => ({ value: t.id, label: t.name, tags: t.tags ?? [] })),
    [topics],
  );

  const selectedSet = new Set(selectedIds);
  const batchCount = Math.max(1, Math.ceil(questions.length / MAX_EXPORT_PER_FILE));

  function toggleQuestion(id: string) {
    setError("");
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= MAX_EXPORT_PER_FILE) {
        setError(`Maksimal ${MAX_EXPORT_PER_FILE} soal per satu berkas Word. Ekspor dalam beberapa batch.`);
        return current;
      }
      return [...current, id];
    });
  }

  function selectBatch(batchIndex: number) {
    setError("");
    const start = batchIndex * MAX_EXPORT_PER_FILE;
    setSelectedIds(questions.slice(start, start + MAX_EXPORT_PER_FILE).map((q) => q.id));
  }

  function clearSelection() {
    setError("");
    setSelectedIds([]);
  }

  async function handleExport() {
    if (pending || selectedIds.length === 0) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/data-modul/export-soal/unduh", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-NusaCBT-Export": "1",
        },
        body: JSON.stringify({
          questionIds: selectedIds,
          includeKeys,
          title,
        }),
      });
      if (!response.ok) {
        const message = (await response.text().catch(() => "")).trim() || "Dokumen Word gagal dibuat.";
        if (response.status === 401) {
          router.push("/login");
          router.refresh();
          return;
        }
        setError(message);
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/i.exec(disposition);
      const filename = match?.[1] || "ekspor-soal-nusacbt.docx";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(`Berhasil mengekspor ${selectedIds.length} soal ke ${filename}`);
    } catch {
      setError("Koneksi gagal saat mengekspor dokumen Word. Coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="gap-0 rounded-[20px] p-5 sm:p-6">
        <h2 className="font-bold">Filter bank soal</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Saring soal menurut topik atau kata kunci, lalu pilih hingga {MAX_EXPORT_PER_FILE} soal per berkas <code>.docx</code>.
        </p>
        <form action="/data-modul/export-soal" method="get" className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="export-topic" className="mb-1 block text-xs font-semibold">
              Topik / Mata Pelajaran
            </label>
            <SearchableCombobox
              id="export-topic"
              name="topik"
              options={topicOptions}
              value={filterTopicId}
              onChange={setFilterTopicId}
              placeholder="Semua topik"
              searchPlaceholder="Cari nama mata pelajaran atau tag..."
              emptyOptionLabel="Semua topik"
              allowClear
            />
          </div>
          <div>
            <label htmlFor="export-search" className="mb-1 block text-xs font-semibold">
              Cari isi soal
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="export-search"
                name="cari"
                defaultValue={initialSearch}
                maxLength={100}
                placeholder="Kata dalam soal..."
                className={`${inputClass} pl-9`}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="rounded-xl">Terapkan filter</Button>
            <Button asChild variant="outline" className="rounded-xl">
              <Link href="/data-modul/export-soal" prefetch={false}>Reset</Link>
            </Button>
          </div>
        </form>
      </Card>

      {error && (
        <Alert variant="destructive" role="alert" className="rounded-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Ekspor Word belum selesai</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.85fr)]">
        <Card className="gap-0 overflow-hidden rounded-[20px] py-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div>
              <h2 className="font-bold">
                Daftar soal cocok <Badge variant="secondary">{questions.length}</Badge>
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Terpilih <strong>{selectedIds.length}</strong> dari maksimal {MAX_EXPORT_PER_FILE} soal per file.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: batchCount }, (_, i) => {
                const start = i * MAX_EXPORT_PER_FILE + 1;
                const end = Math.min((i + 1) * MAX_EXPORT_PER_FILE, questions.length);
                if (questions.length === 0) return null;
                return (
                  <Button
                    key={i}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => selectBatch(i)}
                    disabled={pending}
                    className="rounded-lg text-xs"
                  >
                    <CheckSquare className="size-3.5" /> Pilih {start}–{end}
                  </Button>
                );
              })}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                disabled={pending || selectedIds.length === 0}
                className="rounded-lg text-xs"
              >
                <Square className="size-3.5" /> Kosongkan pilihan
              </Button>
            </div>
          </div>

          {questions.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Tidak ada soal yang cocok dengan filter. Tambah soal di{" "}
              <Link href="/data-modul/soal" className="font-semibold text-primary underline">
                Manajemen Soal
              </Link>
              .
            </div>
          ) : (
            <ul aria-label="Daftar soal untuk diekspor" className="max-h-[620px] divide-y divide-border overflow-y-auto">
              {questions.map((item, idx) => {
                const checked = selectedSet.has(item.id);
                const imgCount = (item.hasPromptImage ? 1 : 0) + item.optionImageCount;
                return (
                  <li key={item.id} className="flex items-start gap-3 px-5 py-4 hover:bg-muted/30">
                    <input
                      type="checkbox"
                      aria-label={`Pilih soal nomor ${idx + 1}`}
                      checked={checked}
                      disabled={pending}
                      onChange={() => toggleQuestion(item.id)}
                      className="mt-1 size-4 shrink-0 accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-muted-foreground">#{idx + 1}</span>
                        <Badge variant="outline" className="text-[11px]">{item.topicName}</Badge>
                        {(item.topicTags ?? []).map((tag) => (
                          <Badge key={tag} variant="outline" className="rounded-full text-[10px] font-medium">{tag}</Badge>
                        ))}
                        <Badge variant="secondary" className="text-[11px]">Kunci {item.correctOption}</Badge>
                        {imgCount > 0 && (
                          <Badge variant="outline" className="gap-1 text-[11px]">
                            <ImageIcon className="size-3" /> {imgCount} gambar
                          </Badge>
                        )}
                      </div>
                      <p dir="auto" className="mt-1.5 line-clamp-2 break-words text-sm text-foreground">
                        {item.promptPreview || "(Soal bergambar)"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="gap-0 rounded-[20px] p-5 sm:p-6">
          <div className="flex items-start gap-3 border-b pb-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <FileText className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-bold">Pengaturan berkas Word</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Menghasilkan tabel 4 kolom (<code>No</code>, <code>Jenis</code>, <code>Isi</code>, <code>Jawaban</code>) yang kompatibel dengan{" "}
                <strong>Import Soal Word</strong>.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="export-title" className="mb-1.5 block text-xs font-semibold">
                Judul dokumen Word
              </label>
              <input
                id="export-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                className={inputClass}
                placeholder="Daftar Soal Pilihan Ganda NusaCBT"
              />
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/30 p-3.5 text-sm">
              <input
                type="checkbox"
                checked={includeKeys}
                onChange={(e) => setIncludeKeys(e.target.checked)}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                <strong className="block text-xs font-semibold">Sertakan kunci jawaban (1 / 0)</strong>
                <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">
                  Centang agar kolom Jawaban terisi 1 dan 0 sehingga dapat langsung diimpor ulang ke NusaCBT. Kosongkan jika ingin naskah latihan tanpa kunci.
                </span>
              </span>
            </label>

            <Alert className="rounded-xl">
              <Info className="size-4" />
              <AlertDescription className="text-xs leading-5">
                Teks berformat, teks Arab (RTL), tabel, rumus Equation Word (OMML), dan gambar PNG/JPEG ikut disertakan (maks. 100 soal dan 16 MiB total gambar per file).
              </AlertDescription>
            </Alert>

            <Button
              type="button"
              onClick={handleExport}
              disabled={pending || selectedIds.length === 0}
              className="h-11 w-full rounded-xl font-semibold"
            >
              <Download className="size-4" />{" "}
              {pending ? "Menyiapkan Word..." : `Ekspor ${selectedIds.length} soal ke Word (.docx)`}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
