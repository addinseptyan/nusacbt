"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, KeyRound } from "lucide-react";

import { beginExamAction } from "@/app/peserta/jadwal/[runId]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function StartForm({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(beginExamAction, { error: "" });
  const [open, setOpen] = useState(true);
  const [token, setToken] = useState("");
  const [caret, setCaret] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  return <div className="mt-6">
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <DialogTrigger asChild><Button type="button" className="rounded-xl">Masukkan token <ArrowRight className="size-4" /></Button></DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[min(90dvh,40rem)] overflow-y-auto rounded-[24px] p-5 sm:max-w-md sm:p-7"
        onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}>
        <DialogHeader className="text-left">
          <span className="mb-2 flex size-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"><KeyRound className="size-5" /></span>
          <DialogTitle className="text-xl font-bold">Masukkan token ujian</DialogTitle>
          <DialogDescription>Masukkan enam angka dari pengawas untuk mulai mengerjakan. Angka nol di depan tetap diperlukan.</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="runId" value={runId} />
          <label htmlFor="exam-token" className="block text-sm font-semibold">Token tes</label>
          <div className="relative w-full max-w-sm rounded-xl focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-emerald-700">
            <div aria-hidden="true" data-testid="token-slots" className="grid grid-cols-6 gap-1.5 sm:gap-2">
              {Array.from({ length: 6 }, (_, index) => <span key={index} className={`flex h-12 min-w-0 items-center justify-center rounded-xl border text-xl font-bold tabular-nums sm:h-14 ${token[index] ? "border-emerald-400 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100" : "border-input bg-background"} ${Math.min(caret, 5) === index ? "ring-1 ring-emerald-500/50" : ""}`}>{token[index] || "·"}</span>)}
            </div>
            <input ref={input} id="exam-token" name="token" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={token} disabled={pending}
              aria-describedby="token-help" aria-invalid={Boolean(state.error)} className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
              onChange={(event) => { const next = event.currentTarget.value.replace(/[^0-9]/g, "").slice(0, 6); setToken(next); setCaret(Math.min(event.currentTarget.selectionStart ?? next.length, 6)); }}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
              onPaste={(event) => { const next = event.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, 6); if (next) { event.preventDefault(); setToken(next); setCaret(next.length); requestAnimationFrame(() => input.current?.setSelectionRange(next.length, next.length)); } }} />
          </div>
          <p id="token-help" className="text-xs leading-5 text-muted-foreground">Ketik atau tempel enam angka. Token hanya diperiksa saat mulai.</p>
          {state.error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{state.error} {state.login && <Link className="underline" href="/peserta/login?sesi=berakhir">Masuk kembali</Link>}</div>}
          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="rounded-xl" disabled={pending} onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit" className="rounded-xl" disabled={pending}>{pending ? "Menyiapkan soal…" : "Mulai pengerjaan"}</Button>
          </div>
          {pending && <p role="status" className="text-xs leading-5 text-muted-foreground">Menyiapkan soal. Jika koneksi terputus, muat ulang jadwal untuk memeriksa apakah tes sudah dimulai.</p>}
        </form>
      </DialogContent>
    </Dialog>
    <noscript><form action={action} className="mt-4 space-y-3"><input type="hidden" name="runId" value={runId} /><label htmlFor="exam-token-fallback" className="block text-sm font-semibold">Token tes</label><Input id="exam-token-fallback" name="token" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoComplete="one-time-code" className="max-w-xs" /><p className="text-xs text-muted-foreground">Masukkan enam angka dari pengawas.</p>{state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}<Button type="submit">Mulai pengerjaan</Button></form></noscript>
  </div>;
}
