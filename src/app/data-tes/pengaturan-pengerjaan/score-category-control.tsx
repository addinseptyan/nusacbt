"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

import { saveScoreCategoryVisibility } from "@/app/data-tes/pengaturan-pengerjaan/score-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ExamRunKind } from "@/lib/exam-session-types";

const labels: Record<ExamRunKind, string> = { regular: "Reguler", makeup: "Susulan", remedial: "Remidi" };
export type ScoreCategory = { kind: ExamRunKind; visible: boolean; revision: string };

export function ScoreCategoryControl({ kind, visible, revision }: ScoreCategory) {
  const router = useRouter();
  const [open, setOpen] = useState(false); const [pending, startTransition] = useTransition();
  const [error, setError] = useState(""); const [reload, setReload] = useState(false); const [message, setMessage] = useState("");
  const name = labels[kind];
  function change() {
    const form = new FormData(); form.set("kind", kind); form.set("revision", revision); form.set("visible", String(!visible));
    setError(""); setMessage("");
    startTransition(async () => {
      try {
        const result = await saveScoreCategoryVisibility(form);
        if (!result.ok) { setError(result.error); setReload(Boolean(result.reload)); return; }
        setOpen(false); setMessage(result.message); router.refresh();
      } catch { setError("Hasil perubahan belum dapat dipastikan. Muat ulang untuk memeriksa."); setReload(true); }
    });
  }
  return <section aria-label={`Pengaturan nilai ${name}`} className="rounded-2xl border bg-background p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-sm font-bold">{name}</h3><p className="mt-1 text-xs text-muted-foreground">Nilai peserta: {visible ? "ditampilkan" : "disembunyikan"}</p></div>
      <Dialog open={open} onOpenChange={(next) => { if (!pending) { setOpen(next); if (next) { setError(""); setReload(false); } } }}>
        <DialogTrigger asChild><Button type="button" variant={visible ? "outline" : "default"} className="rounded-xl" disabled={pending}>
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {visible ? "Sembunyikan nilai" : "Tampilkan nilai"}</Button></DialogTrigger>
        <DialogContent showCloseButton={false} className="rounded-2xl sm:max-w-md" onEscapeKeyDown={(e) => { if (pending) e.preventDefault(); }} onInteractOutside={(e) => { if (pending) e.preventDefault(); }}>
          <DialogHeader><DialogTitle>{visible ? "Sembunyikan nilai peserta?" : "Tampilkan nilai peserta?"}</DialogTitle>
            <DialogDescription>Kategori {name} · Berlaku untuk seluruh tes, termasuk pengerjaan lama yang selesai.</DialogDescription></DialogHeader>
          <p className="text-sm leading-6">{visible ? "Nilai tidak lagi dikirim pada permintaan berikutnya. Nilai yang sudah dilihat atau disalin peserta tidak dapat ditarik kembali." : "Pemilik pengerjaan yang sudah selesai dapat melihat nilainya. Jawaban benar dan kunci tidak ditampilkan; ini bukan nilai akhir gabungan."}</p>
          {error && <p role="alert" className="rounded-xl bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Batal</Button>
            {reload ? <Button type="button" onClick={() => { setOpen(false); router.refresh(); }}>Muat ulang</Button>
              : <Button type="button" disabled={pending} onClick={change}>{pending ? "Menyimpan…" : visible ? "Ya, sembunyikan" : "Ya, tampilkan"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    {message && <p role="status" className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">{message}</p>}
  </section>;
}
