"use client";

// Gambar privat harus memakai permintaan cookie peserta langsung, bukan image optimizer/cache.
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, Flag, GraduationCap, RotateCcw } from "lucide-react";

import { checkExamSubmissionAction, saveExamAnswerAction, saveExamDoubtAction, submitExamAction } from "@/app/peserta/pengerjaan/[attemptId]/actions";
import { QuestionRichDisplay } from "@/components/question-rich-display";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AttemptView, WorkResult } from "@/lib/exam-attempt-work";

type WorkingView = Extract<AttemptView, { state: "working" }>;
type DialogState =
  | { kind: "checking" }
  | { kind: "blocked"; windowMinutes: number }
  | { kind: "ready"; windowMinutes: number; answered: number; doubtful: number; total: number }
  | { kind: "error"; message: string; login?: boolean };
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

type NavigationItem = WorkingView["navigation"][number];
function questionStatus(item: NavigationItem) {
  return item.doubtful ? `ragu-ragu, ${item.answered ? "terjawab" : "belum dijawab"}` : item.answered ? "terjawab" : "belum dijawab";
}
function questionColor(item: NavigationItem) {
  return item.doubtful ? "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100" : item.answered ? "border-emerald-300 bg-emerald-100 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-900 dark:text-emerald-100" : "border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
}

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
  const [selectedDoubt, setSelectedDoubt] = useState(view.question.doubtful);
  const [confirmedDoubt, setConfirmedDoubt] = useState(view.question.doubtful);
  const [doubtRevision, setDoubtRevision] = useState(view.question.doubtRevision);
  const [pendingKind, setPendingKind] = useState<"answer" | "doubt">("answer");
  const [mode, setMode] = useState<"idle" | "saving" | "unsaved" | "checking" | "submitting" | "submit-unknown" | "navigating">("idle");
  const [failure, setFailure] = useState<Extract<WorkResult, { ok: false }> | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((Date.parse(view.deadline) - Date.parse(view.serverNow)) / 1000)));
  const localDeadline = useRef<number | null>(null);
  const inFlight = useRef(false);
  const refreshed = useRef(false);
  const compactNavigation = useRef<HTMLElement>(null);
  const blocked = mode !== "idle";
  const navigation = view.navigation.map((item) => item.position === view.position
    ? { ...item, answered: confirmed !== null, doubtful: confirmedDoubt } : item);
  const confirmedAnswered = navigation.filter((item) => item.answered).length;
  const doubtfulCount = navigation.filter((item) => item.doubtful).length;
  const answeredClear = navigation.filter((item) => item.answered && !item.doubtful).length;
  const unansweredClear = view.total - doubtfulCount - answeredClear;

  useEffect(() => {
    if (localDeadline.current === null) localDeadline.current = Date.now() + Math.max(0, Date.parse(view.deadline) - Date.parse(view.serverNow));
    const tick = () => setSeconds(Math.max(0, Math.ceil((localDeadline.current! - Date.now()) / 1000)));
    const timer = window.setInterval(tick, 1000); tick();
    return () => window.clearInterval(timer);
  }, [view.deadline, view.serverNow]);

  useEffect(() => {
    const nav = compactNavigation.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (nav && active && nav.clientWidth > 0) {
      nav.scrollLeft = Math.max(0, active.offsetLeft - nav.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2);
    }
  }, [view.position]);

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
    inFlight.current = true; setPendingKind("answer"); setSelected(desired); setFailure(null); setMode("saving");
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

  async function saveDoubt(desired: boolean) {
    if (inFlight.current) return;
    inFlight.current = true; setPendingKind("doubt"); setSelectedDoubt(desired); setFailure(null); setMode("saving");
    const form = new FormData();
    form.set("attemptId", view.attemptId); form.set("position", String(view.position));
    form.set("doubtful", String(desired)); form.set("revision", doubtRevision);
    try {
      const result = await saveExamDoubtAction(form);
      if (result.ok && typeof result.revision === "string") {
        setDoubtRevision(result.revision); setConfirmedDoubt(desired); setMode("idle");
      } else {
        setFailure(result.ok ? { ok: false, error: "Konfirmasi tanda ragu tidak lengkap. Muat ulang untuk memeriksa.", reload: true } : result);
        setMode("unsaved");
      }
    } catch {
      setFailure({ ok: false, error: "Koneksi terputus atau konfirmasi belum diterima. Tanda ragu ini belum dapat dianggap aman; coba simpan lagi." });
      setMode("unsaved");
    } finally { inFlight.current = false; }
  }

  async function checkSubmission() {
    if (inFlight.current || blocked) return;
    inFlight.current = true; setFailure(null); setDialog({ kind: "checking" }); setMode("checking");
    const form = new FormData(); form.set("attemptId", view.attemptId);
    try {
      const result = await checkExamSubmissionAction(form);
      if (!result.ok && result.closed) { setDialog(null); setMode("navigating"); router.refresh(); }
      else if (!result.ok) { setDialog({ kind: "error", message: result.error, login: result.login }); setMode("idle"); }
      else if (!result.allowed) { setDialog({ kind: "blocked", windowMinutes: result.windowMinutes }); setMode("idle"); }
      else { setDialog({ kind: "ready", windowMinutes: result.windowMinutes, answered: result.answered, doubtful: result.doubtful, total: result.total }); setMode("idle"); }
    } catch {
      setDialog({ kind: "error", message: "Batas pengumpulan belum dapat diperiksa. Periksa koneksi dan coba lagi." }); setMode("idle");
    } finally { inFlight.current = false; }
  }

  async function submit() {
    if (inFlight.current || blocked || dialog?.kind !== "ready") return;
    inFlight.current = true; setFailure(null); setMode("submitting");
    const form = new FormData(); form.set("attemptId", view.attemptId);
    try {
      const result = await submitExamAction(form);
      if (result.ok) { setDialog(null); setMode("navigating"); router.refresh(); }
      else if (result.tooEarly && result.windowMinutes) { setDialog({ kind: "blocked", windowMinutes: result.windowMinutes }); setMode("idle"); }
      else { setDialog(null); setFailure(result); setMode("submit-unknown"); }
    } catch {
      setDialog(null); setFailure({ ok: false, error: "Hasil penyelesaian belum dapat dipastikan. Muat ulang untuk memeriksa status." });
      setMode("submit-unknown");
    } finally { inFlight.current = false; }
  }

  function reload() {
    if ((mode === "unsaved" || mode === "saving") && !window.confirm("Perubahan terakhir belum terkonfirmasi. Muat ulang untuk memeriksa data di server?")) return;
    window.location.reload();
  }

  const base = `/peserta/pengerjaan/${view.attemptId}`;
  const image = (slot: string) => `${base}/gambar/${view.position}/${slot}`;
  const legend = [
    { label: "Sudah dijawab", count: answeredClear, color: "border-emerald-300 bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900" },
    { label: "Ragu-ragu", count: doubtfulCount, color: "border-amber-300 bg-amber-100 dark:border-amber-700 dark:bg-amber-900" },
    { label: "Belum dijawab", count: unansweredClear, color: "border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-800" },
    { label: "Soal aktif", count: null, color: "border-background bg-background ring-2 ring-indigo-600 ring-offset-1 ring-offset-card dark:ring-indigo-400" },
  ];
  const identity = [{ label: "Nama", value: view.participant.name }, { label: "NISN", value: view.participant.nisn },
    { label: "Kelas", value: view.participant.className }, { label: "Periode ujian", value: view.participant.period }];
  return <main className="min-h-svh bg-[#f6f8f6] dark:bg-[#101713]">
    <header className="sticky top-0 z-40 border-b bg-card/95 shadow-sm backdrop-blur" data-testid="exam-sticky-header"><div className="mx-auto max-w-[1400px] px-3 py-2 sm:px-6 sm:py-2.5">
      <div className="flex items-center gap-2 sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 xl:max-w-[260px]"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-white shadow-sm sm:size-10"><GraduationCap className="size-4 sm:size-5" /></span>
          <div className="min-w-0"><p className="whitespace-nowrap text-[10px] font-bold tracking-[0.12em] text-emerald-700 uppercase dark:text-emerald-300">NusaCBT<span className="hidden sm:inline"> · Ujian</span></p><p className="truncate text-xs font-bold sm:text-sm" title={`${view.testName} · ${view.runLabel}`}>{view.testName}</p></div></div>
        <dl className="hidden min-w-0 flex-1 grid-cols-4 gap-3 border-l pl-4 text-xs xl:grid">
          {identity.map((item) => <div key={item.label} className="min-w-0"><dt className="text-[10px] text-muted-foreground">{item.label}</dt><dd className="truncate font-semibold" title={item.value}>{item.value}</dd></div>)}
        </dl>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2"><div title="Waktu mengikuti jam server" className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1 sm:gap-2 sm:px-3 sm:py-1.5 ${seconds <= 300 ? "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100" : "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"}`}>
          <Clock3 className="size-3.5 shrink-0 sm:size-4" aria-hidden="true" /><div><p className="text-[9px] font-bold uppercase sm:text-[10px]">Waktu</p><p className="font-mono text-sm leading-4 font-bold tabular-nums sm:text-base sm:leading-5" aria-label={`Waktu tersisa ${remainingText(seconds)}`}>{remainingText(seconds)}</p></div></div><ThemeToggle /></div>
      </div>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t pt-1.5 text-[11px] leading-4 sm:grid-cols-4 xl:hidden">
        {identity.map((item) => <div key={item.label} className="flex min-w-0 items-baseline gap-1"><dt className="shrink-0 text-[10px] text-muted-foreground">{item.label}:</dt><dd className="truncate font-semibold" title={item.value}>{item.value}</dd></div>)}
      </dl>
      <div className="mt-1.5 flex items-center justify-between gap-2 border-t pt-1.5 lg:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] leading-4">
            <span className="font-semibold text-foreground">{confirmedAnswered}/{view.total} terjawab</span>
            {doubtfulCount > 0 && <span className="text-amber-700 dark:text-amber-300">· {doubtfulCount} ragu</span>}
            <span className="text-muted-foreground">({view.total ? Math.round(100 * confirmedAnswered / view.total) : 0}%)</span>
          </div>
          <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <span className="bg-emerald-600" style={{ width: `${100 * answeredClear / view.total}%` }} /><span className="bg-amber-400" style={{ width: `${100 * doubtfulCount / view.total}%` }} /><span className="bg-slate-300 dark:bg-slate-600" style={{ width: `${100 * unansweredClear / view.total}%` }} />
          </div>
        </div>
        <Button type="button" size="sm" aria-label="Kumpulkan atau akhiri tes" disabled={!hydrated || blocked} onClick={() => void checkSubmission()}
          className="h-7 shrink-0 rounded-lg bg-indigo-600 px-2.5 text-[11px] font-semibold text-white shadow-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:text-white dark:hover:bg-indigo-600">
          <CheckCircle2 className="size-3.5" /> Kumpulkan
        </Button>
      </div>
      <nav ref={compactNavigation} aria-label="Navigasi nomor soal ringkas" className="mt-1.5 flex max-w-full gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 lg:hidden">
        {navigation.map((item) => <button key={item.position} type="button" disabled={!hydrated || blocked} aria-current={item.position === view.position ? "step" : undefined}
          aria-label={`Nomor ${item.position}, ${questionStatus(item)}`} onClick={() => { if (item.position !== view.position) navigate(`${base}?soal=${item.position}`); }}
          className={`size-8 shrink-0 rounded-lg border text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 disabled:opacity-50 sm:size-9 ${item.position === view.position ? "ring-2 ring-inset ring-indigo-600 dark:ring-indigo-400" : ""} ${questionColor(item)}`}>{item.position}</button>)}
      </nav>
    </div></header>
    <div className="mx-auto max-w-[1400px] px-3 pb-24 pt-3 sm:px-6 sm:pb-28 sm:pt-4">
      <noscript><div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">JavaScript diperlukan untuk menyimpan jawaban. Aktifkan JavaScript lalu muat ulang halaman; pilihan yang belum dikirim tidak tersimpan.</div></noscript>
      <p className="sr-only">Waktu mengikuti server. Saat habis, jawaban tersimpan akan dikumpulkan otomatis.</p>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 rounded-[20px] border bg-card p-3.5 sm:rounded-[22px] sm:p-5" aria-labelledby="question-heading">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5 sm:gap-3 sm:pb-3"><h1 id="question-heading" className="text-base font-bold sm:text-lg">Soal {view.position} <span className="text-xs font-normal text-muted-foreground sm:text-sm">/ {view.total}</span></h1>
            <span role="status" aria-live="polite" className={`text-xs font-semibold ${mode === "unsaved" || mode === "submit-unknown" ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"}`}>
              {mode === "saving" ? pendingKind === "doubt" ? "Menyimpan tanda ragu…" : "Menyimpan jawaban…" : mode === "unsaved" ? "Belum dikonfirmasi tersimpan" : mode === "checking" ? "Memeriksa pengumpulan…" : mode === "submitting" ? "Menyelesaikan tes…" : mode === "submit-unknown" ? "Status perlu diperiksa" : mode === "navigating" ? "Memuat halaman…" : confirmed ? "Tersimpan di server" : confirmedDoubt ? "Tanda ragu tersimpan" : "Belum dijawab"}
            </span></div>
          <div className="mt-3 text-[15px] leading-6"><QuestionRichDisplay document={view.question.promptRich} fallback={view.question.prompt} />
            {view.question.hasPromptImage && <img src={image("prompt")} alt="Gambar soal" className="mt-3 h-auto max-h-[480px] max-w-full rounded-lg object-contain" />}</div>
          <fieldset className="mt-3 space-y-2 sm:space-y-1.5" disabled={!hydrated || blocked || seconds === 0}>
            <legend className="mb-2 text-sm font-semibold">Pilih satu jawaban</legend>
            {view.question.options.map((option) => <label key={option.id} className={`flex min-w-0 cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm leading-5 transition-colors has-[:disabled]:cursor-not-allowed sm:gap-3 sm:py-2 ${selected === option.id ? "border-emerald-600 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/40" : "bg-background hover:bg-muted/40"}`}>
              <input type="radio" name={`question-${view.position}`} value={option.id} checked={selected === option.id} onChange={() => void save(option.id)} className="mt-1 size-4 shrink-0 accent-emerald-700" />
              <span className="font-bold">{option.label}.</span><span className="min-w-0 flex-1"><QuestionRichDisplay document={option.rich} fallback={option.text} />
                {option.hasImage && <img src={image(option.id)} alt={`Gambar pilihan ${option.label}`} className="mt-2 h-auto max-h-[320px] max-w-full rounded-lg object-contain" />}</span>
            </label>)}
          </fieldset>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
              <input type="checkbox" checked={selectedDoubt} disabled={!hydrated || blocked || seconds === 0} onChange={(event) => void saveDoubt(event.currentTarget.checked)} className="size-4 accent-amber-700" /> <Flag className="size-4" /> Ragu-ragu
            </label>
            <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl border-border px-3 font-medium shadow-2xs" disabled={!hydrated || blocked || !confirmed || seconds === 0} onClick={() => void save(null)}><RotateCcw className="size-3.5" aria-hidden="true" /> Kosongkan jawaban</Button>
          </div>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">Tanda ragu tidak menghapus jawaban dan dapat dipakai pada soal yang belum dijawab.</p>
          {failure && <div role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-6 text-destructive"><p>{failure.error}</p>
            {mode === "unsaved" && <p className="mt-1 font-semibold">{pendingKind === "doubt" ? "Tanda ragu" : "Pilihan terakhir"} belum terkonfirmasi; jangan dianggap aman.</p>}
            <div className="mt-3 flex flex-wrap gap-2">{mode === "unsaved" && !failure.reload && !failure.closed && !failure.login && seconds > 0 && <Button type="button" size="sm" onClick={() => { if (pendingKind === "doubt") void saveDoubt(selectedDoubt); else void save(selected); }}>Coba simpan lagi</Button>}
              <Button type="button" size="sm" variant="outline" onClick={reload}>Muat ulang untuk memeriksa</Button>
              {failure.login && <Button type="button" size="sm" variant="outline" onClick={() => { if (window.confirm("Perubahan terakhir belum terkonfirmasi. Masuk kembali untuk memeriksa data tersimpan?")) router.push("/peserta/login?sesi=berakhir"); }}>Masuk kembali</Button>}</div>
          </div>}
          {mode === "navigating" && <p className="mt-4 text-xs text-muted-foreground">Memuat halaman. Jika tidak berlanjut, <button type="button" className="underline" onClick={reload}>muat ulang</button>.</p>}
          {seconds === 0 && mode !== "unsaved" && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">Memeriksa waktu dan status pada server…</p>}
        </section>
        <aside data-testid="exam-number-panel" className="hidden rounded-[20px] border bg-card p-3.5 sm:rounded-[22px] sm:p-4 lg:sticky lg:top-32 lg:block lg:max-h-[calc(100dvh-13rem)] lg:overflow-y-auto xl:top-24 xl:max-h-[calc(100dvh-10rem)]">
          <div className="flex items-start justify-between gap-2"><div><h2 className="text-sm font-bold">Navigasi soal</h2><p className="mt-0.5 text-xs text-muted-foreground lg:mt-1">{confirmedAnswered} dari {view.total} terjawab</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{view.total ? Math.round(100 * confirmedAnswered / view.total) : 0}%</span></div>
          <div role="img" aria-label={`Progres status: ${answeredClear} sudah dijawab tanpa ragu, ${doubtfulCount} ragu-ragu, ${unansweredClear} belum dijawab`} className="mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 lg:mt-3">
            <span className="bg-emerald-600" style={{ width: `${100 * answeredClear / view.total}%` }} /><span className="bg-amber-400" style={{ width: `${100 * doubtfulCount / view.total}%` }} /><span className="bg-slate-300 dark:bg-slate-600" style={{ width: `${100 * unansweredClear / view.total}%` }} />
          </div>
          <ul aria-label="Keterangan status soal" className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px] leading-4 lg:mt-3 lg:gap-y-2">
            {legend.map((item) => <li key={item.label} className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className={`size-3.5 shrink-0 rounded border ${item.color}`} /><span>{item.label}{item.count !== null ? ` (${item.count})` : ""}</span></li>)}
          </ul>
          <p className="mt-2 hidden text-[11px] leading-4 text-muted-foreground lg:block">Ragu-ragu termasuk soal yang sudah atau belum dijawab. Garis menunjukkan soal aktif.</p>
          <nav aria-label="Navigasi soal" className="mt-2 hidden max-h-64 overflow-y-auto overscroll-contain p-2 lg:block" style={{ scrollbarGutter: "stable" }}>
            <div className="grid grid-cols-5 gap-2">{navigation.map((item) => {
              return <button key={item.position} type="button" disabled={!hydrated || blocked} aria-current={item.position === view.position ? "step" : undefined}
                aria-label={`Soal ${item.position}, ${questionStatus(item)}`} onClick={() => { if (item.position !== view.position) navigate(`${base}?soal=${item.position}`); }}
                className={`h-9 rounded-lg border text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 ${item.position === view.position ? "ring-2 ring-indigo-600 ring-offset-2 ring-offset-card dark:ring-indigo-400" : ""} ${questionColor(item)}`}>{item.position}</button>;
            })}</div>
          </nav>
          <div className="mt-3 border-t pt-3">
            <Button type="button" className="w-full rounded-xl bg-indigo-600 font-semibold text-white shadow-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:text-white dark:hover:bg-indigo-600" disabled={!hydrated || blocked} onClick={() => void checkSubmission()}><CheckCircle2 className="size-4" /> Kumpulkan tes</Button>
          </div>
        </aside>
      </div>
    </div>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open && !inFlight.current) setDialog(null); }}>
      {dialog && <DialogContent showCloseButton={false} className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{dialog.kind === "checking" ? "Memeriksa pengumpulan" : dialog.kind === "blocked" ? "Belum dapat dikumpulkan" : dialog.kind === "error" ? "Pemeriksaan belum berhasil" : "Kumpulkan tes sekarang?"}</DialogTitle>
          <DialogDescription>{dialog.kind === "checking" ? "Memeriksa sisa waktu dan pengaturan terbaru pada server…" : dialog.kind === "blocked" ? `Pengumpulan manual hanya tersedia pada ${dialog.windowMinutes} menit terakhir sebelum waktu tes habis.` : dialog.kind === "error" ? "Tes belum dikumpulkan melalui pemeriksaan ini." : `Pengumpulan manual tersedia pada ${dialog.windowMinutes} menit terakhir.`}</DialogDescription>
        </DialogHeader>
        {dialog.kind === "ready" && <div className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100"><p><strong>{dialog.answered}</strong> dari {dialog.total} soal terjawab; <strong>{dialog.total - dialog.answered}</strong> belum dijawab dan <strong>{dialog.doubtful}</strong> ditandai ragu-ragu.</p><p className="mt-2 text-xs leading-5">Jumlah terjawab termasuk soal ragu yang memiliki jawaban. Jawaban kosong bernilai nol. Setelah dikumpulkan, pengerjaan tidak dapat diubah.</p></div>}
        {dialog.kind === "blocked" && <p className="rounded-xl bg-muted/60 p-3 text-sm leading-6">Lanjutkan mengerjakan. Saat waktu habis, jawaban yang tersimpan dikumpulkan otomatis.</p>}
        {dialog.kind === "error" && <p role="alert" className="rounded-xl bg-destructive/5 p-3 text-sm text-destructive">{dialog.message}</p>}
        <DialogFooter>
          {dialog.kind === "checking" ? <span role="status" className="text-xs text-muted-foreground">Memeriksa…</span> : <Button type="button" variant="outline" disabled={mode === "submitting"} onClick={() => setDialog(null)}>{dialog.kind === "ready" ? "Batal" : "Tutup"}</Button>}
          {dialog.kind === "ready" && <Button type="button" disabled={mode === "submitting"} onClick={() => void submit()}>{mode === "submitting" ? "Mengumpulkan…" : "Ya, kumpulkan"}</Button>}
          {dialog.kind === "error" && dialog.login && <Button type="button" onClick={() => router.push("/peserta/login?sesi=berakhir")}>Masuk kembali</Button>}
        </DialogFooter>
      </DialogContent>}
    </Dialog>
    <nav aria-label="Navigasi sebelumnya dan berikutnya" data-testid="exam-bottom-nav" className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 px-3 py-2.5 shadow-[0_-6px_24px_rgba(0,0,0,0.06)] backdrop-blur sm:px-6 sm:py-3" style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}>
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-2">
        <Button type="button" variant="outline" className="shrink-0 whitespace-nowrap rounded-xl px-2.5 text-xs sm:px-4 sm:text-sm" disabled={!hydrated || blocked || view.position <= 1} onClick={() => navigate(`${base}?soal=${view.position - 1}`)}><ChevronLeft className="size-4" /> Sebelumnya</Button>
        <span aria-label={`Soal ${view.position} dari ${view.total}`} className="whitespace-nowrap text-center text-[11px] font-semibold tabular-nums text-muted-foreground sm:text-xs">{view.position} / {view.total}</span>
        <Button type="button" className="shrink-0 whitespace-nowrap rounded-xl px-2.5 text-xs sm:px-4 sm:text-sm" disabled={!hydrated || blocked || view.position >= view.total} onClick={() => navigate(`${base}?soal=${view.position + 1}`)}>Berikutnya <ChevronRight className="size-4" /></Button>
      </div>
    </nav>
  </main>;
}
