"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

import { saveScoreVisibility } from "@/app/data-tes/monitoring/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function ScoreVisibilityControl({ id, name, visible, revision }: { id: string; name: string; visible: boolean; revision: string }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [pending, startTransition] = useTransition();
  const [error, setError] = useState(""); const [reload, setReload] = useState(false); const [message, setMessage] = useState("");
  function change() {
    const form = new FormData(); form.set("testId", id); form.set("revision", revision); form.set("visible", String(!visible));
    setError(""); setMessage("");
    startTransition(async () => {
      try {
        const result = await saveScoreVisibility(form);
        if (!result.ok) { setError(result.error); setReload(Boolean(result.reload)); return; }
        setOpen(false); setMessage(result.message); router.refresh();
      } catch { setError("Hasil perubahan belum dapat dipastikan. Muat ulang untuk memeriksa."); setReload(true); }
    });
  }
  return <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm font-bold">Nilai peserta: {visible ? "ditampilkan" : "disembunyikan"}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Berlaku untuk semua pelaksanaan tes ini, hanya setelah pengerjaan selesai.</p></div>
      <Dialog open={open} onOpenChange={(next) => { if (!pending) { setOpen(next); if (next) { setError(""); setReload(false); } } }}>
        <DialogTrigger asChild><Button type="button" variant={visible ? "outline" : "default"} className="rounded-xl" disabled={pending}>
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {visible ? "Sembunyikan nilai" : "Tampilkan nilai"}</Button></DialogTrigger>
        <DialogContent showCloseButton={false} className="rounded-2xl sm:max-w-md">
          <DialogHeader><DialogTitle>{visible ? "Sembunyikan nilai peserta?" : "Tampilkan nilai peserta?"}</DialogTitle>
            <DialogDescription className="break-words">{name} · Pengaturan berlaku untuk seluruh pelaksanaan dan peserta tes ini.</DialogDescription></DialogHeader>
          <p className="text-sm leading-6">{visible ? "Nilai tidak lagi dikirim pada permintaan berikutnya. Nilai yang sudah dilihat atau disalin peserta tidak dapat ditarik kembali." : "Peserta yang sudah selesai dapat melihat nilai satu pengerjaan. Jawaban benar dan kunci tidak ditampilkan; ini bukan nilai akhir gabungan."}</p>
          {error && <p role="alert" className="rounded-xl bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Batal</Button>
            {reload ? <Button type="button" onClick={() => { setOpen(false); router.refresh(); }}>Muat ulang</Button>
              : <Button type="button" disabled={pending} onClick={change}>{pending ? "Menyimpan…" : visible ? "Ya, sembunyikan" : "Ya, tampilkan"}</Button>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
    {message && <p role="status" className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">{message}</p>}
  </div>;
}
