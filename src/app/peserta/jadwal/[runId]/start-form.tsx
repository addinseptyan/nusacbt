"use client";

import { useActionState, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardList, KeyRound, X } from "lucide-react";

import { beginExamAction } from "@/app/peserta/jadwal/[runId]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

type Props = { runId: string; testName?: string; runLabel?: string; initialOpen?: boolean };
export function StartForm({ runId, testName, runLabel, initialOpen = true }: Props) {
  const [state, action, pending] = useActionState(beginExamAction, { error: "" });
  const [open, setOpen] = useState(initialOpen);
  const [token, setToken] = useState(""); const [caret, setCaret] = useState(0); const [focused, setFocused] = useState(false);
  const [warning, setWarning] = useState(""); const [edited, setEdited] = useState(false);
  const hydrated = useSyncExternalStore(subscribe, clientReady, serverReady);
  const input = useRef<HTMLInputElement>(null); const id = useId(); const helpId = `${id}-help`; const errorId = `${id}-error`;
  // Jangan tampilkan kembali error dari percobaan sebelumnya saat request
  // baru sedang diproses. Error server baru muncul setelah respons selesai.
  const shownError = warning || (!pending && !edited ? state.error : "");
  function changeOpen(next: boolean) {
    if (pending) return;
    setOpen(next); setWarning(""); setEdited(true);
    if (!next) { setToken(""); setCaret(0); setFocused(false); }
  }
  function focusAt(position: number) {
    input.current?.focus(); const next = Math.max(0, Math.min(position, token.length));
    input.current?.setSelectionRange(next, next); setCaret(next);
  }
  return <div className={initialOpen ? "mt-6" : "mt-4"}>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button type="button" size={initialOpen ? "default" : "sm"} className="rounded-xl" disabled={!hydrated || pending}>
        {initialOpen ? "Masukkan token" : "Mulai tes"} <ArrowRight className="size-4" /></Button></DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[min(92dvh,42rem)] gap-4 overflow-y-auto rounded-[24px] p-4 shadow-2xl sm:max-w-[440px] sm:p-6"
        onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}
        onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader className="gap-0 text-left">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><KeyRound className="size-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1"><p className="text-[10px] font-bold tracking-[0.12em] text-emerald-700 uppercase dark:text-emerald-300">Akses pengerjaan</p><DialogTitle className="mt-0.5 text-base leading-5 font-bold">Masukkan token ujian</DialogTitle></div>
            <Button type="button" variant="ghost" size="icon-sm" className="rounded-lg text-muted-foreground" aria-label="Tutup" disabled={pending} onClick={() => changeOpen(false)}><X className="size-4" aria-hidden="true" /></Button>
          </div>
          <DialogDescription className="mt-2 text-[13px] leading-5">Masukkan enam angka dari pengawas untuk membuka tes.</DialogDescription>
        </DialogHeader>
        {testName && <div className="flex min-w-0 items-start gap-2.5 rounded-2xl border bg-muted/35 p-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-background text-emerald-700 dark:text-emerald-300"><ClipboardList className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0"><p className="text-[10px] font-bold tracking-[0.08em] text-muted-foreground uppercase">Tes yang akan dimulai</p><p className="mt-0.5 break-words text-sm leading-5 font-semibold">{testName}</p>{runLabel && <p className="break-words text-xs leading-4 text-muted-foreground">{runLabel}</p>}</div>
        </div>}
        <form action={action} noValidate className="space-y-2.5" onSubmit={(event) => {
          if (!/^[0-9]{6}$/.test(token)) { event.preventDefault(); setWarning("Token salah. Masukkan tepat enam angka."); focusAt(token.length); }
          else { setWarning(""); setEdited(false); }
        }}>
          <input type="hidden" name="runId" value={runId} />
          <div className="flex items-center justify-between gap-3"><label htmlFor={id} className="text-sm font-semibold">Token tes</label><span aria-hidden="true" className="text-xs font-medium text-muted-foreground">{token.length} / 6 angka</span></div>
          <div className="relative w-full rounded-xl focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-emerald-600 dark:focus-within:outline-emerald-400">
            <div aria-hidden="true" data-testid="token-slots" className="grid grid-cols-6 gap-1.5 sm:gap-2">
              {Array.from({ length: 6 }, (_, index) => <span key={index} className={`relative flex h-12 min-w-0 items-center justify-center rounded-xl border text-xl font-bold tabular-nums sm:h-14 ${token[index] ? "border-emerald-400 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100" : "border-input bg-background text-muted-foreground/60"} ${focused && Math.min(caret, 5) === index ? "ring-2 ring-emerald-500/40" : ""}`}>
                {token[index] || "·"}{focused && Math.min(caret, 5) === index && <i data-testid="token-caret" className={`token-caret pointer-events-none absolute h-6 w-0.5 rounded-full bg-emerald-700 dark:bg-emerald-300 ${caret === 6 ? "right-2" : token[index] ? "left-2" : "left-1/2"}`} />}
              </span>)}
            </div>
            <input ref={input} id={id} name="token" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={token} disabled={pending}
              aria-describedby={shownError ? `${helpId} ${errorId}` : helpId} aria-invalid={Boolean(shownError)} className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              onPointerDown={(event) => {
                event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
                const position = Math.floor((event.clientX - rect.left) / (rect.width / 6)); focusAt(position);
              }}
              onBeforeInput={(event) => { const value = (event.nativeEvent as InputEvent).data; if (value && /[^0-9]/.test(value)) { event.preventDefault(); setWarning("Token hanya boleh berisi angka."); setEdited(true); } }}
              onChange={(event) => {
                const raw = event.currentTarget.value; const next = raw.replace(/[^0-9]/g, "").slice(0, 6);
                setToken(next); setCaret(Math.min(event.currentTarget.selectionStart ?? next.length, next.length)); setEdited(true);
                setWarning(/[^0-9]/.test(raw) ? "Token hanya boleh berisi angka." : "");
              }}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
              onPaste={(event) => {
                event.preventDefault(); const raw = event.clipboardData.getData("text");
                if (!/^[0-9]{1,6}$/.test(raw)) { setWarning("Token salah. Tempel maksimal enam angka tanpa huruf."); setEdited(true); return; }
                setToken(raw); setCaret(raw.length); setWarning(""); setEdited(true);
                requestAnimationFrame(() => input.current?.setSelectionRange(raw.length, raw.length));
              }} />
          </div>
          <p id={helpId} className="text-xs leading-4 text-muted-foreground">Ketik atau tempel kode. Nol di depan tetap diperlukan.</p>
          {shownError && <div id={errorId} role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{shownError} {state.login && !warning && <Link className="underline" href="/peserta/login?sesi=berakhir">Masuk kembali</Link>}</div>}
          <DialogFooter className="-mx-4 -mb-4 flex-col sm:bottom-[-1.5rem] sm:-mx-6 sm:-mb-6 sm:flex-col">
            {pending && <p role="status" className="text-xs leading-5 text-muted-foreground">Menyiapkan soal. Jika koneksi terputus, muat ulang jadwal untuk memeriksa apakah tes sudah dimulai.</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" className="h-11 rounded-xl" disabled={pending} onClick={() => changeOpen(false)}>Batal</Button>
              <Button type="submit" className="h-11 rounded-xl" disabled={pending}>{pending ? "Menyiapkan soal…" : "Mulai pengerjaan"} {!pending && <ArrowRight className="size-4" aria-hidden="true" />}</Button></div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {initialOpen ? <noscript><form action={action} className="mt-4 space-y-3"><input type="hidden" name="runId" value={runId} /><label htmlFor={`${id}-fallback`} className="block text-sm font-semibold">Token tes</label><Input id={`${id}-fallback`} name="token" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoComplete="one-time-code" className="max-w-xs" /><p className="text-xs text-muted-foreground">Masukkan enam angka dari pengawas.</p>{state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}<Button type="submit">Mulai pengerjaan</Button></form></noscript>
      : <noscript><Button asChild size="sm" variant="outline" className="mt-2 rounded-xl"><Link href={`/peserta/jadwal/${runId}`}>Mulai tes tanpa JavaScript</Link></Button></noscript>}
  </div>;
}
