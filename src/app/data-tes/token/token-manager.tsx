"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Copy, Info, KeyRound, Plus, RefreshCw, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { issueExamToken, resolveUncertainTokenIssue, revokeExamToken } from "@/app/data-tes/token/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AccessTokenRecord, AccessTokenScope, AccessTokenTestOption, TokenIssued } from "@/lib/exam-token-types";
import { EXAM_TOKEN_FORM_VERSION, EXAM_TOKEN_MAX_MINUTES, EXAM_TOKEN_MIN_MINUTES, validTokenOperationId } from "@/lib/exam-token-validation.mjs";

const PAGE_SIZE = 10;
// Hanya UUID permintaan, tidak pernah kode token. sessionStorage bertahan saat
// halaman tab dimuat ulang, tetapi tidak dijamin jika tab/browser ditutup.
const PENDING_ISSUE_KEY = "nusacbt.token.pending-issue.v1";
function newOperationId() {
  // getRandomValues tersedia juga pada HTTP LAN; randomUUID membutuhkan HTTPS.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function forgetPendingIssue(id: string) {
  try { if (sessionStorage.getItem(PENDING_ISSUE_KEY) === id) sessionStorage.removeItem(PENDING_ISSUE_KEY); } catch { /* Pemeriksaan ulang aman jika penyimpanan gagal. */ }
}
const selectClass = "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";
const offsets = { WIB: 7, WITA: 8, WIT: 9 } as const;
type Zone = keyof typeof offsets;
type Notice = { message: string; reload?: boolean } | null;
type TokenStatus = "Aktif" | "Kedaluwarsa" | "Dicabut" | "Diganti" | "Tes dihapus";

function formatTime(value: string, zone: Zone) {
  const date = new Date(Date.parse(value) + offsets[zone] * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${zone}`;
}
function tokenStatus(token: AccessTokenRecord, now: number): TokenStatus {
  const expires = Date.parse(token.expiresAt);
  if (token.revokedAt && Date.parse(token.revokedAt) < expires) return token.revokedReason === "replaced" ? "Diganti" : "Dicabut";
  if (token.scope === "test" && !token.testId && !token.revokedAt) return "Tes dihapus";
  if (token.revokedAt || expires <= now) return "Kedaluwarsa";
  return "Aktif";
}
function tokenName(token: AccessTokenRecord) {
  if (token.scope === "global") return "Seluruh tes (global)";
  return token.testId ? `${token.currentTestName ?? token.testNameSnapshot ?? "Tes"} · #${token.testId}${token.periodName ? ` · ${token.periodName}` : ""}` : `${token.testNameSnapshot ?? "Tes"} (tes dihapus)`;
}
function ErrorNotice({ error, onReload }: { error: NonNullable<Notice>; onReload: () => void }) {
  return <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription><span>{error.message}</span>{error.reload && <Button type="button" variant="outline" size="sm" className="mt-3 block" onClick={onReload}>Muat ulang status</Button>}</AlertDescription></Alert>;
}

function TokenEditor({ tests, tokens, now, zone, onClose, onUncertain }: { tests: AccessTokenTestOption[]; tokens: AccessTokenRecord[]; now: number; zone: Zone; onClose: () => void; onUncertain: (operationId: string) => void }) {
  const router = useRouter();
  // Jangan mengganti snapshot yang sudah dilihat admin saat formulir terbuka.
  const [initialTests] = useState(tests); const [initialTokens] = useState(tokens);
  const [scope, setScope] = useState<AccessTokenScope>("global"); const [testId, setTestId] = useState("");
  const [confirmed, setConfirmed] = useState(false); const [error, setError] = useState<Notice>(null); const [issued, setIssued] = useState<TokenIssued | null>(null);
  const [copyMessage, setCopyMessage] = useState(""); const [pending, startTransition] = useTransition(); const submitting = useRef(false);
  const selectedTest = initialTests.find((test) => test.id === testId);
  const current = initialTokens.find((token) => token.revokedAt === null && token.scope === scope && (scope === "global" || (testId && token.testId === testId))) ?? null;
  const replacingActive = Boolean(current && tokenStatus(current, now) === "Aktif");
  function close() { if (!pending && !issued) onClose(); }
  function reload() { if (!pending) { onClose(); router.refresh(); } }
  function finish() { onClose(); router.refresh(); }
  async function copyCode() {
    if (!issued) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(issued.code); setCopyMessage("Kode disalin. Bagikan hanya kepada pihak yang berwenang.");
    } catch { setCopyMessage("Penyalinan otomatis tidak tersedia. Pilih kode lalu salin secara manual."); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (error?.reload || submitting.current) return;
    const data = new FormData(event.currentTarget);
    data.set("formVersion", EXAM_TOKEN_FORM_VERSION); data.set("scope", scope); data.set("expectedTokenId", current?.id ?? "none");
    if (scope === "test") {
      if (!selectedTest) { setError({ message: "Pilih satu tes." }); return; }
      data.set("testId", selectedTest.id); data.set("testRevision", selectedTest.revision);
    } else { data.delete("testId"); data.delete("testRevision"); }
    let operationId: string;
    try {
      const previous = sessionStorage.getItem(PENDING_ISSUE_KEY);
      if (previous) {
        const id = validTokenOperationId(previous);
        if (id) { onUncertain(id); return; }
        throw new Error("Identitas permintaan tersimpan tidak valid.");
      }
      operationId = newOperationId();
      sessionStorage.setItem(PENDING_ISSUE_KEY, operationId);
      if (sessionStorage.getItem(PENDING_ISSUE_KEY) !== operationId) throw new Error("Penyimpanan sesi gagal.");
    } catch { setError({ message: "Penyimpanan sesi browser tidak tersedia atau data permintaan rusak. Jangan membuat token; aktifkan penyimpanan sesi dan muat ulang halaman." }); return; }
    data.set("operationId", operationId); setError(null); submitting.current = true;
    startTransition(async () => {
      try {
        const result = await issueExamToken(data);
        if (!result.ok) {
          if (result.uncertain) { onUncertain(operationId); return; }
          forgetPendingIssue(operationId); setError({ message: result.error, reload: result.reload }); return;
        }
        forgetPendingIssue(operationId);
        setIssued({ code: result.code, issuedAt: result.issuedAt, expiresAt: result.expiresAt, scope: result.scope, testName: result.testName });
      } catch { onUncertain(operationId); }
      finally { submitting.current = false; }
    });
  }
  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-xl" showCloseButton={!pending && !issued} onEscapeKeyDown={(event) => { if (pending || issued) event.preventDefault(); }} onInteractOutside={(event) => { if (pending || issued) event.preventDefault(); }}>
    {issued ? <><DialogHeader><DialogTitle>Token berhasil dibuat</DialogTitle><DialogDescription>Kode hanya ditampilkan sekali. Salin atau catat sekarang; setelah dialog ditutup atau halaman dimuat ulang, kode tidak dapat dibuka kembali.</DialogDescription></DialogHeader>
      <div className="space-y-4"><div className="space-y-2"><label htmlFor="issued-token" className="text-sm font-bold">Kode token baru</label><div className="flex gap-2"><Input id="issued-token" readOnly autoComplete="off" spellCheck={false} value={issued.code} onFocus={(event) => event.currentTarget.select()} className="h-12 min-w-0 font-mono text-lg font-bold tracking-wide" /><Button type="button" variant="outline" className="h-12" onClick={copyCode}><Copy className="size-4" /> Salin</Button></div><p role="status" className="text-xs text-muted-foreground">{copyMessage}</p></div><p className="rounded-xl bg-muted/50 p-3 text-xs leading-5">Cakupan: <strong className="break-words text-foreground">{issued.scope === "global" ? "Seluruh tes" : issued.testName}</strong><br />Kedaluwarsa: <strong className="text-foreground">{formatTime(issued.expiresAt, zone)}</strong>. Masa aktif mengikuti jam server.</p><p className="text-xs leading-5 text-muted-foreground">Jangan bagikan kode pada chat publik atau simpan dalam repository. Pada tahap ini peserta belum dapat menggunakan token untuk masuk.</p></div>
      <DialogFooter><Button type="button" onClick={finish}>Saya sudah mencatat, tutup</Button></DialogFooter></>
      : <><DialogHeader><DialogTitle>Buat token</DialogTitle><DialogDescription>Token berlaku sejak diterbitkan oleh server selama 5–1440 menit. Kode akan ditampilkan satu kali setelah berhasil dibuat.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4 pt-1">
        <div className="space-y-2"><label htmlFor="token-scope" className="text-sm font-semibold">Cakupan token</label><select id="token-scope" name="scope" value={scope} onChange={(event) => { setScope(event.target.value as AccessTokenScope); setTestId(""); setConfirmed(false); setError((previous) => previous?.reload ? previous : null); }} disabled={pending} className={selectClass}><option value="global">Global — seluruh tes</option><option value="test">Khusus satu tes</option></select></div>
        {scope === "test" && <div className="space-y-2"><label htmlFor="token-test" className="text-sm font-semibold">Pilih tes</label><select id="token-test" name="testId" required value={testId} onChange={(event) => { setTestId(event.target.value); setConfirmed(false); setError((previous) => previous?.reload ? previous : null); }} disabled={pending} className={selectClass}><option value="">Pilih satu tes</option>{initialTests.map((test) => <option key={test.id} value={test.id}>{test.name} (#{test.id} · {test.periodName})</option>)}</select>{!initialTests.length && <p className="text-xs text-muted-foreground">Belum ada rancangan tes. Buat tes dahulu untuk token khusus.</p>}</div>}
        <div className="space-y-2"><label htmlFor="token-duration" className="text-sm font-semibold">Masa aktif (menit)</label><Input id="token-duration" name="durationMinutes" type="number" min={EXAM_TOKEN_MIN_MINUTES} max={EXAM_TOKEN_MAX_MINUTES} step={1} defaultValue={15} required disabled={pending} className="h-11 rounded-xl" /><p className="text-xs text-muted-foreground">Minimal 5 menit, maksimal 1440 menit (1 hari).</p></div>
        {current && <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Token saat ini #{current.id}: <strong>{tokenStatus(current, now)}</strong>, kedaluwarsa {formatTime(current.expiresAt, zone)}. {replacingActive ? "Membuat token baru akan mencabut token aktif sebelumnya untuk cakupan yang sama." : "Token sebelumnya sudah tidak aktif."}{replacingActive && <label className="mt-3 flex items-start gap-2 font-semibold"><input type="checkbox" name="replaceConfirmed" value="1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required disabled={pending} className="mt-0.5 size-4 shrink-0 accent-primary" /> Saya memahami token sebelumnya akan diganti.</label>}</div>}
        <p className="rounded-xl bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">Untuk tahap peserta nanti, token khusus yang aktif diprioritaskan. Ketika token khusus berakhir atau dicabut, token global yang masih aktif dapat digunakan kembali.</p>
        {error && <ErrorNotice error={error} onReload={reload} />}
        <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="submit" disabled={pending || Boolean(error?.reload) || (scope === "test" && !selectedTest)}>{pending ? "Membuat..." : "Buat token"}</Button></DialogFooter>
      </form></>}
  </DialogContent></Dialog>;
}

function UncertainIssueDialog({ operationId, onFinish }: { operationId: string; onFinish: () => void }) {
  const [pending, startTransition] = useTransition(); const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<{ outcome: "issued" | "cancelled"; tokenId: string | null } | null>(null);
  function resolve() {
    if (pending || outcome) return;
    const data = new FormData(); data.set("operationId", operationId); setError("");
    startTransition(async () => {
      try {
        const result = await resolveUncertainTokenIssue(data);
        if (!result.ok) { setError(result.error); return; }
        forgetPendingIssue(operationId); setOutcome({ outcome: result.outcome, tokenId: result.tokenId });
      } catch { setError("Belum dapat memastikan hasil. Periksa sambungan dan coba periksa lagi; jangan membuat token lain dahulu."); }
    });
  }
  return <Dialog open><DialogContent showCloseButton={false} onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()} className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md">
    <DialogHeader><DialogTitle>Hasil pembuatan belum pasti</DialogTitle><DialogDescription>Periksa dan amankan permintaan sebelum membuat token lain. Jangan tutup tab atau hapus data sesi browser sampai selesai.</DialogDescription></DialogHeader>
    {!outcome ? <p className="text-sm leading-6 text-muted-foreground">Server akan memeriksa apakah token sempat dibuat. Bila belum, permintaan lama akan dibatalkan agar tidak dapat menerbitkan token jika datang terlambat. Kode tidak dapat dipulihkan.</p>
      : <Alert role="status"><Info className="size-4" /><AlertTitle>{outcome.outcome === "issued" ? "Token sempat dibuat" : "Permintaan diamankan"}</AlertTitle><AlertDescription>{outcome.outcome === "issued" ? <>Permintaan menghasilkan {outcome.tokenId ? `token #${outcome.tokenId}` : "token yang riwayatnya tidak tersedia"}. Kode tidak dapat ditampilkan kembali. Periksa daftar; bila token itu masih aktif, cabut lalu buat token baru.</> : "Permintaan yang belum menghasilkan token telah dibatalkan; jika datang terlambat, permintaan itu tidak dapat membuat token. Periksa status terbaru sebelum membuat ulang."}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
    <DialogFooter>{outcome ? <Button type="button" onClick={onFinish}>Tutup dan muat ulang status</Button> : <Button type="button" disabled={pending} onClick={resolve}>{pending ? "Memeriksa..." : "Periksa dan amankan"}</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}

function RevokeDialog({ token, onClose }: { token: AccessTokenRecord; onClose: () => void }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState<Notice>(null);
  function close() { if (!pending) onClose(); }
  function reload() { close(); router.refresh(); }
  function revoke() {
    if (error?.reload) return;
    const data = new FormData(); data.set("id", token.id); data.set("revision", token.revision); data.set("confirmed", "1"); setError(null);
    startTransition(async () => {
      try { const result = await revokeExamToken(data); if (!result.ok) { setError({ message: result.error, reload: result.reload }); return; } onClose(); toast.success(result.message); router.refresh(); }
      catch { setError({ message: "Hasil pencabutan belum dapat dipastikan. Muat ulang status sebelum mencoba lagi.", reload: true }); }
    });
  }
  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md" showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}><DialogHeader><DialogTitle>Cabut token?</DialogTitle><DialogDescription>Token #{token.id} untuk <strong className="break-words text-foreground">{tokenName(token)}</strong> akan segera tidak berlaku. {token.scope === "test" ? "Saat fungsi peserta tersedia, token global yang masih aktif dapat digunakan kembali untuk tes ini." : "Token khusus tes tidak ikut dicabut."}</DialogDescription></DialogHeader>{error && <ErrorNotice error={error} onReload={reload} />}<DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="button" variant="destructive" disabled={pending || Boolean(error?.reload)} onClick={revoke}>{pending ? "Mencabut..." : "Ya, cabut token"}</Button></DialogFooter></DialogContent></Dialog>;
}

export function TokenManager({ tests, tokens, serverNow }: { tests: AccessTokenTestOption[]; tokens: AccessTokenRecord[]; serverNow: string }) {
  const router = useRouter(); const [zone, setZone] = useState<Zone>("WIB"); const [scopeFilter, setScopeFilter] = useState(""); const [page, setPage] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false); const [revoking, setRevoking] = useState<AccessTokenRecord | null>(null);
  const [storageState, setStorageState] = useState<"checking" | "available" | "unavailable" | "invalid">("checking");
  const [unresolved, setUnresolved] = useState<string | null>(null);
  const [clock, setClock] = useState({ serverNow, elapsed: 0 });
  useEffect(() => {
    // Baca penyimpanan tab setelah hidrasi; tidak tersedia saat render server.
    const timer = window.setTimeout(() => {
      try {
        const previous = sessionStorage.getItem(PENDING_ISSUE_KEY);
        const id = previous ? validTokenOperationId(previous) : null;
        if (previous && !id) { setStorageState("invalid"); return; }
        if (id) setUnresolved(id);
        setStorageState("available");
      } catch { setStorageState("unavailable"); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => setClock({ serverNow, elapsed: performance.now() - started }), 1000);
    return () => window.clearInterval(timer);
  }, [serverNow]);
  const now = Date.parse(serverNow) + (clock.serverNow === serverNow ? clock.elapsed : 0);
  const filtered = tokens.filter((token) => !scopeFilter || token.scope === scopeFilter);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); const currentPage = Math.min(page, pages - 1); const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  return <>
    <Alert className="mb-6 max-w-4xl rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200"><Info className="size-4" /><AlertTitle className="text-[12px] font-bold">Persiapan admin, belum untuk ujian</AlertTitle><AlertDescription className="text-[12px] leading-5">Token dapat dibuat dan dicabut, tetapi login peserta dan pemeriksaan token saat mulai tes belum tersedia. Status aktif hanya menunjukkan masa token; token belum membuka atau melindungi akses peserta.</AlertDescription></Alert>
    <Alert className="mb-6 max-w-4xl rounded-2xl"><Info className="size-4" /><AlertTitle>Aturan dan keamanan token</AlertTitle><AlertDescription className="text-xs leading-5">Kode ditampilkan sekali dan hanya hash yang disimpan. Satu token belum dicabut per cakupan; pembuatan baru mengganti token lama. Kelak, token khusus yang aktif mengesampingkan token global untuk tes tersebut. Setelah khusus berakhir atau dicabut, token global aktif berlaku kembali. Waktu mengikuti server; tampilan status merupakan perkiraan sejak dimuat.</AlertDescription></Alert>
    {(storageState === "unavailable" || storageState === "invalid") && <Alert variant="destructive" role="alert" className="mb-6 max-w-4xl"><Info className="size-4" /><AlertTitle>Pembuatan token belum tersedia</AlertTitle><AlertDescription>Penyimpanan sesi browser tidak tersedia atau identitas permintaan tersimpan rusak. Jangan membuat token; aktifkan penyimpanan sesi dan muat ulang halaman.</AlertDescription></Alert>}
    <Card className="gap-0 overflow-hidden rounded-[18px] bg-card py-0 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5 sm:px-6"><div><div className="flex items-center gap-2.5"><h2 className="text-[15px] font-bold">Daftar token</h2><Badge variant="secondary" className="rounded-full text-[10px]">{tokens.length} ditampilkan</Badge></div><p className="mt-1 text-[12px] text-muted-foreground">Slot terbaru dan maksimal 100 riwayat token yang sudah ditutup atau tesnya dihapus.</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => router.refresh()} className="h-10 rounded-xl"><RefreshCw className="size-4" /> Muat ulang status</Button><Button type="button" disabled={storageState !== "available" || Boolean(unresolved)} onClick={() => setEditorOpen(true)} className="h-10 rounded-xl px-4 font-semibold"><Plus className="size-4" /> Buat token</Button></div></div>
      <div className="grid gap-3 border-b border-border p-5 sm:grid-cols-2 sm:px-6"><div className="space-y-1"><label htmlFor="token-filter" className="text-xs font-semibold">Filter cakupan</label><select id="token-filter" value={scopeFilter} onChange={(event) => { setScopeFilter(event.target.value); setPage(0); }} className={selectClass}><option value="">Semua cakupan</option><option value="global">Global</option><option value="test">Khusus tes</option></select></div><div className="space-y-1"><label htmlFor="token-zone" className="text-xs font-semibold">Tampilkan waktu dalam</label><select id="token-zone" value={zone} onChange={(event) => setZone(event.target.value as Zone)} className={selectClass}><option value="WIB">WIB (UTC+7)</option><option value="WITA">WITA (UTC+8)</option><option value="WIT">WIT (UTC+9)</option></select></div></div>
      {!visible.length ? <div className="flex flex-col items-center px-6 py-14 text-center"><span className="flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"><KeyRound className="size-6" /></span><h3 className="mt-4 text-sm font-bold">{tokens.length ? "Tidak ada token untuk filter ini" : "Belum ada token"}</h3><p className="mt-1.5 max-w-sm text-xs leading-6 text-muted-foreground">Buat token global atau untuk satu rancangan tes.</p></div> : <ul aria-label="Daftar token" className="divide-y divide-border">{visible.map((token) => { const status = tokenStatus(token, now); return <li key={token.id} className="flex flex-col gap-4 p-5 sm:px-6 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-bold">{tokenName(token)}</h3><Badge variant={status === "Aktif" ? "default" : "secondary"} className="rounded-full text-[10px]">{status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Token #{token.id} · {token.durationMinutes} menit · dibuat oleh {token.createdBy ?? "admin tidak tersedia"}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">Dibuat: {formatTime(token.issuedAt, zone)} · Kedaluwarsa: <strong className="text-foreground">{formatTime(token.expiresAt, zone)}</strong></p>{token.revokedAt && <p className="mt-1 text-xs leading-5 text-muted-foreground">{token.revokedReason === "replaced" ? "Diganti/ditutup" : "Dicabut"}: {formatTime(token.revokedAt, zone)} · oleh {token.revokedBy ?? "admin tidak tersedia"}</p>}{token.scope === "test" && token.testId && token.testNameSnapshot !== token.currentTestName && <p className="mt-1 break-words text-xs text-muted-foreground">Nama saat token dibuat: {token.testNameSnapshot}</p>}</div>{status === "Aktif" && <Button type="button" variant="outline" size="sm" aria-label={`Cabut token ${token.id}`} onClick={() => setRevoking(token)} className="w-fit text-destructive hover:text-destructive"><ShieldOff className="size-3.5" /> Cabut</Button>}</li>; })}</ul>}
      {filtered.length > PAGE_SIZE && <div className="flex items-center justify-between gap-2 border-t border-border p-5 text-xs sm:px-6"><span>Halaman {currentPage + 1} dari {pages}</span><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="size-4" /> Sebelumnya</Button><Button type="button" variant="outline" size="sm" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Berikutnya <ChevronRight className="size-4" /></Button></div></div>}
    </Card>
    {editorOpen && <TokenEditor tests={tests} tokens={tokens} now={now} zone={zone} onClose={() => setEditorOpen(false)} onUncertain={(operationId) => { setEditorOpen(false); setUnresolved(operationId); }} />}
    {unresolved && <UncertainIssueDialog operationId={unresolved} onFinish={() => { setUnresolved(null); router.refresh(); }} />}
    {revoking && <RevokeDialog token={revoking} onClose={() => setRevoking(null)} />}
  </>;
}
