"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Award, ChevronLeft, ChevronRight } from "lucide-react";

import { participantSharedScoresAction, type SharedScoresResult } from "@/app/peserta/actions";
import { ScoreReveal } from "@/components/score-reveal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** Riwayat nilai terpisah dari jadwal, sehingga jadwal hari lain tetap tersembunyi. */
export function SharedScoresDialog() {
  const [open, setOpen] = useState(false); const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SharedScoresResult | null>(null); const sequence = useRef(0);
  const hydrated = useSyncExternalStore(subscribe, clientReady, serverReady);
  async function load(page: number) {
    const current = ++sequence.current; setLoading(true); setResult(null);
    try { const data = await participantSharedScoresAction(String(page)); if (sequence.current === current) setResult(data); }
    catch { if (sequence.current === current) setResult({ ok: false, error: "Nilai belum dapat dimuat. Periksa koneksi dan coba lagi." }); }
    finally { if (sequence.current === current) setLoading(false); }
  }
  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) void load(1);
    else { sequence.current += 1; setLoading(false); setResult(null); }
  }
  return <>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button type="button" variant="outline" className="h-9 rounded-xl px-3 text-xs font-semibold" disabled={!hydrated}><Award className="size-4" /> Nilai dibagikan</Button></DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[min(90dvh,44rem)] overflow-y-auto rounded-[24px] p-5 sm:max-w-lg sm:p-6">
        <DialogHeader><DialogTitle>Nilai yang dibagikan</DialogTitle><DialogDescription>Nilai pengerjaan yang dibuka pengawas. Nilai akhir ditampilkan setelah ditetapkan dan seluruh kategori penyumbangnya dibuka.</DialogDescription></DialogHeader>
        {loading && <p role="status" className="py-5 text-sm text-muted-foreground">Memuat nilai…</p>}
        {result && !result.ok && <div role="alert" className="rounded-xl bg-destructive/5 p-3 text-sm text-destructive">{result.error} {result.login && <Link className="underline" href="/peserta/login?sesi=berakhir">Masuk kembali</Link>}</div>}
        {result?.ok && (result.data.scores.length === 0 ? <p className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">Belum ada nilai yang dibagikan untuk periode ini.</p>
          : <ul aria-label="Nilai yang dibagikan" className="space-y-2">{result.data.scores.map((score) => <li key={score.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{score.testName}</p><p className="break-words text-xs text-muted-foreground">{score.type === "final" ? `Nilai akhir · ${score.method === "highest" ? "Tertinggi" : "Rata-rata"}` : `${score.kind === "regular" ? "Reguler" : score.kind === "makeup" ? "Susulan" : "Remidi"} · ${score.runLabel} · Pengerjaan ke-${score.attemptNumber}`}</p></div><ScoreReveal score={score.score} /></li>)}</ul>)}
        {result?.ok && result.data.pages > 1 && <nav aria-label="Halaman nilai" className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>Halaman {result.data.page} dari {result.data.pages}</span><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={loading || result.data.page <= 1} onClick={() => void load(result.data.page - 1)}><ChevronLeft className="size-4" /> Sebelumnya</Button><Button type="button" size="sm" variant="outline" disabled={loading || result.data.page >= result.data.pages} onClick={() => void load(result.data.page + 1)}>Berikutnya <ChevronRight className="size-4" /></Button></div></nav>}
        <DialogFooter className="-mx-5 -mb-5 sm:-mx-6 sm:-mb-6">{result && !result.ok && !result.login && <Button type="button" variant="outline" onClick={() => void load(1)}>Coba lagi</Button>}<Button type="button" variant="outline" onClick={() => changeOpen(false)}>Tutup</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <noscript><Button asChild variant="outline" className="h-9 rounded-xl px-3 text-xs"><Link href="/peserta/nilai">Nilai dibagikan tanpa JavaScript</Link></Button></noscript>
  </>;
}
