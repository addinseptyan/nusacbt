"use client";

// Gambar privat harus memakai permintaan cookie peserta langsung, bukan image optimizer/cache.
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, GraduationCap } from "lucide-react";

import { saveExamAnswerAction, submitExamAction } from "@/app/peserta/pengerjaan/[attemptId]/actions";
import { QuestionRichDisplay } from "@/components/question-rich-display";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import type { AttemptView, WorkResult } from "@/lib/exam-attempt-work";

type WorkingView = Extract<AttemptView, { state: "working" }>;
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

function remainingText(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function ExamWork({ view }: { view: WorkingView }) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [selected, setSelected] = useState<string | null>(view.question.answer);
  const [confirmed, setConfirmed] = useState<string | null>(view.question.answer);
  const [revision, setRevision] = useState(view.question.revision);
  const [mode, setMode] = useState<"idle" | "saving" | "unsaved" | "submitting" | "submit-unknown" | "navigating">("idle");
  const [failure, setFailure] = useState<Extract<WorkResult, { ok: false }> | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((Date.parse(view.deadline) - Date.parse(view.serverNow)) / 1000)));
  const localDeadline = useRef<number | null>(null);
  const inFlight = useRef(false);
  const refreshed = useRef(false);
  const blocked = mode !== "idle";
  const confirmedAnswered = view.answered + Number(confirmed !== null) - Number(view.question.answer !== null);

  useEffect(() => {
    if (localDeadline.current === null) localDeadline.current = Date.now() + Math.max(0, Date.parse(view.deadline) - Date.parse(view.serverNow));
    const tick = () => setSeconds(Math.max(0, Math.ceil((localDeadline.current! - Date.now()) / 1000)));
    const timer = window.setInterval(tick, 1000); tick();
    return () => window.clearInterval(timer);
  }, [view.deadline, view.serverNow]);

  useEffect(() => {
    if (seconds === 0 && mode === "idle" && !refreshed.current) { refreshed.current = true; router.refresh(); }
  }, [seconds, mode, router]);

  useEffect(() => {
    if (!blocked || mode === "navigating") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [blocked, mode]);

  function navigate(href: string) {
    if (inFlight.current || blocked) return;
    // Jangan biarkan input soal lama tetap aktif ketika navigasi masih memuat.
    inFlight.current = true; setMode("navigating"); router.push(href);
  }

  async function save(desired: string | null) {
    if (inFlight.current) return;
    inFlight.current = true; setSelected(desired); setFailure(null); setMode("saving"); setConfirmSubmit(false);
    const form = new FormData();
    form.set("attemptId", view.attemptId); form.set("position", String(view.position));
    form.set("answer", desired ?? ""); form.set("revision", revision);
    try {
      const result = await saveExamAnswerAction(form);
      if (result.ok && typeof result.revision === "string") {
        setRevision(result.revision); setConfirmed(desired); setMode("idle");
      } else {
        setFailure(result.ok ? { ok: false, error: "Konfirmasi jawaban tidak lengkap. Muat ulang untuk memeriksa.", reload: true } : result);
        setMode("unsaved");
      }
    } catch {
      setFailure({ ok: false, error: "Koneksi terputus atau konfirmasi belum diterima. Jawaban ini belum dapat dianggap aman; coba simpan lagi." });
      setMode("unsaved");
    } finally { inFlight.current = false; }
  }

  async function submit() {
    if (inFlight.current || blocked) return;
    inFlight.current = true; setFailure(null); setMode("submitting");
    const form = new FormData(); form.set("attemptId", view.attemptId);
    try {
      const result = await submitExamAction(form);
      if (result.ok) { setMode("idle"); router.refresh(); }
      else { setFailure(result); setMode("submit-unknown"); }
    } catch {
      setFailure({ ok: false, error: "Hasil penyelesaian belum dapat dipastikan. Muat ulang untuk memeriksa status." });
      setMode("submit-unknown");
    } finally { inFlight.current = false; }
  }

  function reload() {
    if ((mode === "unsaved" || mode === "saving") && !window.confirm("Jawaban terakhir belum terkonfirmasi. Muat ulang untuk memeriksa jawaban di server?")) return;
    window.location.reload();
  }

  const base = `/peserta/pengerjaan/${view.attemptId}`;
  const image = (slot: string) => `${base}/gambar/${view.position}/${slot}`;
  return <main className="min-h-svh bg-[#f6f8f6] dark:bg-[#101713]">
    <header className="border-b bg-card"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5"><span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-emerald-700 text-white"><GraduationCap className="size-5" /></span>
        <div className="min-w-0"><p className="truncate text-sm font-bold">{view.testName}</p><p className="truncate text-xs text-muted-foreground">{view.runLabel}</p></div></div>
      <div className="flex items-center gap-2"><div className={`rounded-xl px-3 py-2 text-center ${seconds <= 300 ? "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100" : "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"}`}>
        <p className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase"><Clock3 className="size-3" /> Perkiraan sisa</p><p className="font-mono text-lg leading-5 font-bold tabular-nums" aria-label={`Perkiraan sisa waktu ${remainingText(seconds)}`}>{remainingText(seconds)}</p></div><ThemeToggle /></div>
    </div></header>
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-5 sm:px-6 sm:pt-7">
      <noscript><div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">JavaScript diperlukan untuk menyimpan jawaban. Aktifkan JavaScript lalu muat ulang halaman; pilihan yang belum dikirim tidak tersimpan.</div></noscript>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p>Waktu mengikuti server. Saat habis, jawaban tersimpan akan dikumpulkan otomatis.</p><p>{confirmedAnswered} dari {view.total} soal terjawab</p></div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section className="min-w-0 rounded-[22px] border bg-card p-4 sm:p-6" aria-labelledby="question-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4"><h1 id="question-heading" className="text-lg font-bold">Soal {view.position} <span className="text-sm font-normal text-muted-foreground">/ {view.total}</span></h1>
            <span role="status" aria-live="polite" className={`text-xs font-semibold ${mode === "unsaved" || mode === "submit-unknown" ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"}`}>
              {mode === "saving" ? "Menyimpan jawaban…" : mode === "unsaved" ? "Belum dikonfirmasi tersimpan" : mode === "submitting" ? "Menyelesaikan tes…" : mode === "submit-unknown" ? "Status perlu diperiksa" : mode === "navigating" ? "Memuat halaman…" : confirmed ? "Tersimpan di server" : "Belum dijawab"}
            </span></div>
          <div className="mt-5 text-[15px] leading-7"><QuestionRichDisplay document={view.question.promptRich} fallback={view.question.prompt} />
            {view.question.hasPromptImage && <img src={image("prompt")} alt="Gambar soal" className="mt-3 h-auto max-h-[480px] max-w-full rounded-lg object-contain" />}</div>
          <fieldset className="mt-6 space-y-2" disabled={!hydrated || blocked || seconds === 0}>
            <legend className="mb-3 text-sm font-semibold">Pilih satu jawaban</legend>
            {view.question.options.map((option) => <label key={option.id} className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors has-[:disabled]:cursor-not-allowed ${selected === option.id ? "border-emerald-600 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/40" : "bg-background hover:bg-muted/40"}`}>
              <input type="radio" name={`question-${view.position}`} value={option.id} checked={selected === option.id} onChange={() => void save(option.id)} className="mt-1 size-4 shrink-0 accent-emerald-700" />
              <span className="font-bold">{option.label}.</span><span className="min-w-0 flex-1"><QuestionRichDisplay document={option.rich} fallback={option.text} />
                {option.hasImage && <img src={image(option.id)} alt={`Gambar pilihan ${option.label}`} className="mt-2 h-auto max-h-[320px] max-w-full rounded-lg object-contain" />}</span>
            </label>)}
          </fieldset>
          <div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="ghost" size="sm" disabled={!hydrated || blocked || !confirmed || seconds === 0} onClick={() => void save(null)}>Kosongkan jawaban</Button></div>
          {failure && <div role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-6 text-destructive"><p>{failure.error}</p>
            {mode === "unsaved" && <p className="mt-1 font-semibold">Pilihan terakhir belum terkonfirmasi; jangan dianggap aman.</p>}
            <div className="mt-3 flex flex-wrap gap-2">{mode === "unsaved" && !failure.reload && !failure.closed && !failure.login && seconds > 0 && <Button type="button" size="sm" onClick={() => void save(selected)}>Coba simpan lagi</Button>}
              <Button type="button" size="sm" variant="outline" onClick={reload}>Muat ulang untuk memeriksa</Button>
              {failure.login && <Button type="button" size="sm" variant="outline" onClick={() => { if (window.confirm("Jawaban terakhir belum terkonfirmasi. Masuk kembali untuk memeriksa jawaban tersimpan?")) router.push("/peserta/login?sesi=berakhir"); }}>Masuk kembali</Button>}</div>
          </div>}
          {mode === "navigating" && <p className="mt-4 text-xs text-muted-foreground">Memuat halaman. Jika tidak berlanjut, <button type="button" className="underline" onClick={reload}>muat ulang</button>.</p>}
          {seconds === 0 && mode !== "unsaved" && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">Perkiraan waktu habis. Memeriksa status pada server…</p>}
          <div className="mt-6 flex flex-wrap justify-between gap-2 border-t pt-4">
            <Button type="button" variant="outline" disabled={!hydrated || blocked || view.position <= 1} onClick={() => navigate(`${base}?soal=${view.position - 1}`)}><ChevronLeft className="size-4" /> Sebelumnya</Button>
            <Button type="button" disabled={!hydrated || blocked || view.position >= view.total} onClick={() => navigate(`${base}?soal=${view.position + 1}`)}>Berikutnya <ChevronRight className="size-4" /></Button>
          </div>
        </section>
        <aside className="rounded-[22px] border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-bold">Navigasi soal</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Hijau menandai jawaban yang dikonfirmasi server.</p>
          <nav aria-label="Navigasi soal" className="mt-4 grid max-h-72 grid-cols-5 gap-1.5 overflow-y-auto">
            {view.navigation.map((item) => {
              const answered = item.position === view.position ? confirmed !== null : item.answered;
              return <button key={item.position} type="button" disabled={!hydrated || blocked} aria-current={item.position === view.position ? "step" : undefined}
                aria-label={`Soal ${item.position}, ${answered ? "terjawab" : "belum dijawab"}`} onClick={() => { if (item.position !== view.position) navigate(`${base}?soal=${item.position}`); }}
                className={`h-9 rounded-lg border text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 ${item.position === view.position ? "ring-2 ring-emerald-700 ring-offset-1" : ""} ${answered ? "border-emerald-200 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" : "bg-background"}`}>{item.position}</button>;
            })}
          </nav>
          <div className="mt-5 border-t pt-4">
            {!confirmSubmit ? <Button type="button" variant="outline" className="w-full rounded-xl" disabled={!hydrated || blocked} onClick={() => setConfirmSubmit(true)}><CheckCircle2 className="size-4" /> Selesaikan tes</Button>
              : <div className="space-y-3 rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-950/50"><p className="font-semibold">Kumpulkan sekarang?</p><p className="text-xs leading-5">{confirmedAnswered} dari {view.total} soal sudah terjawab. Jawaban kosong bernilai nol. Setelah selesai, pengerjaan ini tidak dapat diubah.</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={blocked} onClick={() => void submit()}>Ya, kumpulkan</Button><Button type="button" size="sm" variant="outline" disabled={blocked} onClick={() => setConfirmSubmit(false)}>Batal</Button></div></div>}
            <Button type="button" variant="ghost" size="sm" className="mt-2 w-full" disabled={!hydrated || blocked} onClick={() => navigate("/peserta")}>Kembali ke jadwal</Button>
          </div>
        </aside>
      </div>
    </div>
  </main>;
}
