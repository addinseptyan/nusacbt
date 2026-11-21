"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";

import { participantAttemptStatus, type ParticipantStatusResult } from "@/app/peserta/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function ParticipantStatusDialog({ attemptId, testName, runLabel }: { attemptId: string; testName: string; runLabel: string }) {
  const [open, setOpen] = useState(false); const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParticipantStatusResult | null>(null); const sequence = useRef(0);
  const hydrated = useSyncExternalStore(subscribe, clientReady, serverReady);
  async function refresh() {
    const current = ++sequence.current; setLoading(true); setResult(null);
    try { const data = await participantAttemptStatus(attemptId); if (sequence.current === current) setResult(data); }
    catch { if (sequence.current === current) setResult({ ok: false, error: "Status belum dapat dimuat. Periksa koneksi dan coba lagi." }); }
    finally { if (sequence.current === current) setLoading(false); }
  }
  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) void refresh();
    else { sequence.current += 1; setLoading(false); setResult(null); }
  }
  return <div className="mt-4">
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button type="button" variant="outline" size="sm" className="rounded-xl" disabled={!hydrated}><ClipboardCheck className="size-4" /> Lihat status pengerjaan</Button></DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[min(90dvh,40rem)] overflow-y-auto rounded-[24px] p-5 sm:max-w-md sm:p-6">
        <DialogHeader><DialogTitle>Status pengerjaan</DialogTitle><DialogDescription className="break-words">{testName} · {runLabel}</DialogDescription></DialogHeader>
        {loading && <p role="status" className="text-sm text-muted-foreground">Memeriksa status terbaru…</p>}
        {result && !result.ok && <div role="alert" className="rounded-xl bg-destructive/5 p-3 text-sm text-destructive">{result.error} {result.login && <Link className="underline" href="/peserta/login?sesi=berakhir">Masuk kembali</Link>}</div>}
        {result?.ok && result.state === "working" && <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/50 dark:text-amber-100"><p>Tes masih berlangsung.</p><Button asChild size="sm" className="mt-3 rounded-xl"><Link href={`/peserta/pengerjaan/${attemptId}`}>Lanjutkan tes</Link></Button></div>}
        {result?.ok && result.state === "finished" && <div className="space-y-3">
          <p className="rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100">{result.reason === "time_expired" ? "Waktu tes habis. Jawaban tersimpan telah dikumpulkan otomatis." : "Jawaban tersimpan telah dikumpulkan."}</p>
          {result.score !== null ? <div className="rounded-xl border border-emerald-200 p-4 dark:border-emerald-800"><p className="text-xs font-semibold text-muted-foreground">Nilai pengerjaan</p><p className="mt-1 text-3xl font-bold tabular-nums">{result.score}</p><p className="mt-1 text-xs text-muted-foreground">Nilai satu pengerjaan, bukan nilai akhir gabungan.</p></div>
            : <p className="text-sm text-muted-foreground">Nilai belum dibagikan oleh pengawas.</p>}
        </div>}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          {result && !result.ok && !result.login && <Button type="button" variant="outline" onClick={() => void refresh()}>Coba lagi</Button>}
          <Button type="button" variant="outline" onClick={() => changeOpen(false)}>Tutup</Button>
        </div>
      </DialogContent>
    </Dialog>
    <noscript><Button asChild variant="outline" size="sm" className="mt-2 rounded-xl"><Link href={`/peserta/pengerjaan/${attemptId}`}>Lihat status tanpa JavaScript</Link></Button></noscript>
  </div>;
}
