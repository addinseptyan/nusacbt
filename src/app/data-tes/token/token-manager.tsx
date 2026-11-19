"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Copy, Globe2, Info, KeyRound, RefreshCw, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { issueExamToken, resolveUncertainTokenIssue, revokeExamToken } from "@/app/data-tes/token/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AccessTokenRecord, AccessTokenScope, AccessTokenTestOption, TokenKeyStatus } from "@/lib/exam-token-types";
import { EXAM_TOKEN_FORM_VERSION, validTokenOperationId } from "@/lib/exam-token-validation.mjs";

const PENDING_ISSUE_KEY = "nusacbt.token.pending-issue.v1";
const selectClass = "h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";
const durations = [{ value: "5", label: "5 menit" }, { value: "15", label: "15 menit" }, { value: "30", label: "30 menit" }, { value: "60", label: "1 jam" }, { value: "120", label: "2 jam" }, { value: "360", label: "6 jam" }, { value: "1440", label: "1 hari" }] as const;
const offsets = { WIB: 7, WITA: 8, WIT: 9 } as const;
type Zone = keyof typeof offsets;
type Notice = { message: string; reload?: boolean } | null;
type TokenStatus = "Aktif" | "Kedaluwarsa" | "Dicabut" | "Diganti" | "Tes dihapus";
type IssueTarget = { scope: AccessTokenScope; test: AccessTokenTestOption | null; slot: AccessTokenRecord | null; duration: string };

function newOperationId() {
  // getRandomValues tersedia juga pada HTTP LAN; randomUUID memerlukan HTTPS.
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function forgetPendingIssue(id: string) {
  try { if (sessionStorage.getItem(PENDING_ISSUE_KEY) === id) sessionStorage.removeItem(PENDING_ISSUE_KEY); } catch { /* Pemeriksaan ulang tetap aman. */ }
}
function formatTime(value: string, zone: Zone) {
  const date = new Date(Date.parse(value) + offsets[zone] * 3_600_000); const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${zone}`;
}
function tokenStatus(token: AccessTokenRecord, now: number): TokenStatus {
  const expires = Date.parse(token.expiresAt);
  if (token.revokedAt && Date.parse(token.revokedAt) < expires) return token.revokedReason === "replaced" ? "Diganti" : "Dicabut";
  if (token.scope === "test" && !token.testId && !token.revokedAt) return "Tes dihapus";
  if (token.revokedAt || expires <= now) return "Kedaluwarsa";
  return "Aktif";
}
function remaining(token: AccessTokenRecord | null, now: number) {
  const seconds = token && tokenStatus(token, now) === "Aktif" ? Math.max(0, Math.ceil((Date.parse(token.expiresAt) - now) / 1000)) : 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds % 3600 / 60))}:${pad(seconds % 60)}`;
}
function tokenName(token: AccessTokenRecord) {
  if (token.scope === "global") return "Token global";
  return token.testId ? `${token.currentTestName ?? token.testNameSnapshot ?? "Tes"} · #${token.testId}${token.periodName ? ` · ${token.periodName}` : ""}` : `${token.testNameSnapshot ?? "Tes"} (tes dihapus)`;
}
function ErrorNotice({ error, onReload }: { error: NonNullable<Notice>; onReload: () => void }) {
  return <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription><span>{error.message}</span>{error.reload && <Button type="button" variant="outline" size="sm" className="mt-3 block" onClick={onReload}>Muat ulang status</Button>}</AlertDescription></Alert>;
}
function TokenCode({ token, label }: { token: AccessTokenRecord | null; label: string }) {
  const code = token?.code;
  const text = !token ? "Belum ada" : code ?? (token.codeStatus === "legacy" ? "Kode lama tidak tersedia" : token.codeStatus === "corrupt" ? "Data token tidak dapat dibuka" : "Kunci tidak tersedia");
  async function copy() {
    if (!code) return;
    try { if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable"); await navigator.clipboard.writeText(code); toast.success("Kode disalin; bagikan hanya kepada pihak berwenang."); }
    catch { toast.error("Penyalinan otomatis tidak tersedia. Pilih kode untuk menyalin manual."); }
  }
  return <div className="flex min-w-0 flex-wrap items-center gap-2"><span aria-label={label} className={code ? "font-mono text-xl font-bold tracking-[0.16em] text-foreground" : "text-xs font-medium text-muted-foreground"}>{text}</span>{code && <Button type="button" variant="ghost" size="icon-sm" aria-label={`Salin ${label.toLowerCase()}`} onClick={copy}><Copy className="size-4" /></Button>}</div>;
}
function DurationSelect({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return <select aria-label={`Durasi token ${id}`} value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>{durations.map((duration) => <option key={duration.value} value={duration.value}>{duration.label}</option>)}</select>;
}

function IssueDialog({ target, now, onClose, onSuccess, onUncertain }: { target: IssueTarget; now: number; onClose: () => void; onSuccess: () => void; onUncertain: (id: string) => void }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState<Notice>(null); const [confirmed, setConfirmed] = useState(false); const submitting = useRef(false);
  const replacing = Boolean(target.slot && tokenStatus(target.slot, now) === "Aktif");
  const duration = durations.find((option) => option.value === target.duration)?.label ?? target.duration;
  function close() { if (!pending) onClose(); }
  function reload() { if (!pending) { onClose(); router.refresh(); } }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (error?.reload || submitting.current) return;
    let id: string;
    try {
      const previous = sessionStorage.getItem(PENDING_ISSUE_KEY);
      if (previous) { const existing = validTokenOperationId(previous); if (existing) { onUncertain(existing); return; } throw new Error("Data rusak"); }
      id = newOperationId(); sessionStorage.setItem(PENDING_ISSUE_KEY, id);
      if (sessionStorage.getItem(PENDING_ISSUE_KEY) !== id) throw new Error("Penyimpanan gagal");
    } catch { setError({ message: "Penyimpanan sesi browser tidak tersedia atau identitas permintaan rusak. Aktifkan penyimpanan sesi dan muat ulang halaman." }); return; }
    const data = new FormData(); data.set("operationId", id); data.set("formVersion", EXAM_TOKEN_FORM_VERSION); data.set("scope", target.scope);
    data.set("durationMinutes", target.duration); data.set("expectedTokenId", target.slot?.id ?? "none");
    if (target.test) { data.set("testId", target.test.id); data.set("testRevision", target.test.revision); }
    if (confirmed) data.set("replaceConfirmed", "1");
    submitting.current = true; setError(null);
    startTransition(async () => {
      try {
        const result = await issueExamToken(data);
        if (!result.ok) { if (result.uncertain) { onUncertain(id); return; } forgetPendingIssue(id); setError({ message: result.error, reload: result.reload }); return; }
        forgetPendingIssue(id); toast.success("Token berhasil diaktifkan."); onSuccess();
      } catch { onUncertain(id); }
      finally { submitting.current = false; }
    });
  }
  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md" showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>{replacing ? "Ganti token aktif?" : "Aktifkan token?"}</DialogTitle><DialogDescription>Token {target.scope === "global" ? "global" : `khusus ${target.test?.name ?? "tes"}`} baru berlaku selama {duration}, dihitung segera sejak dibuat di server.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4">
      {replacing && <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Token sebelumnya #{target.slot?.id} akan langsung tidak berlaku.<label className="mt-3 flex items-start gap-2 font-semibold"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required disabled={pending} className="mt-0.5 size-4 shrink-0 accent-primary" /> Saya memahami token sebelumnya akan diganti.</label></div>}
      {!replacing && target.slot && <p className="rounded-xl bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">Token sebelumnya sudah tidak aktif. Kode baru akan dibuat.</p>}
      {error && <ErrorNotice error={error} onReload={reload} />}
      <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="submit" disabled={pending || Boolean(error?.reload)}>{pending ? "Memproses..." : replacing ? "Ya, ganti token" : "Ya, aktifkan token"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

function UncertainIssueDialog({ operationId, onFinish }: { operationId: string; onFinish: () => void }) {
  const [pending, startTransition] = useTransition(); const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<{ outcome: "issued" | "cancelled"; tokenId: string | null } | null>(null);
  function resolve() {
    if (pending || outcome) return; const data = new FormData(); data.set("operationId", operationId); setError("");
    startTransition(async () => {
      try { const result = await resolveUncertainTokenIssue(data); if (!result.ok) { setError(result.error); return; } forgetPendingIssue(operationId); setOutcome({ outcome: result.outcome, tokenId: result.tokenId }); }
      catch { setError("Belum dapat memastikan hasil. Periksa sambungan dan coba lagi; jangan membuat token lain dahulu."); }
    });
  }
  return <Dialog open><DialogContent showCloseButton={false} onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()} className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md">
    <DialogHeader><DialogTitle>Hasil pembuatan belum pasti</DialogTitle><DialogDescription>Periksa dan amankan permintaan sebelum membuat token lain. Jangan tutup tab atau hapus data sesi browser sampai selesai.</DialogDescription></DialogHeader>
    {!outcome ? <p className="text-sm leading-6 text-muted-foreground">Server akan memeriksa apakah token sempat dibuat. Bila belum, permintaan lama dibatalkan agar tidak membuat token jika datang terlambat.</p> : <Alert role="status"><Info className="size-4" /><AlertTitle>{outcome.outcome === "issued" ? "Token sempat dibuat" : "Permintaan diamankan"}</AlertTitle><AlertDescription>{outcome.outcome === "issued" ? <>Permintaan menghasilkan {outcome.tokenId ? `token #${outcome.tokenId}` : "token yang riwayatnya tidak tersedia"}. Periksa daftar atau riwayat setelah memuat ulang; kode baru dapat ditampilkan jika kunci tersedia.</> : "Permintaan yang belum menghasilkan token dibatalkan; jika datang terlambat, permintaan itu tidak dapat membuat token. Periksa status sebelum membuat ulang."}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
    <DialogFooter>{outcome ? <Button type="button" onClick={onFinish}>Tutup dan muat ulang status</Button> : <Button type="button" disabled={pending} onClick={resolve}>{pending ? "Memeriksa..." : "Periksa dan amankan"}</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}

function RevokeDialog({ token, onClose }: { token: AccessTokenRecord; onClose: () => void }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState<Notice>(null);
  function close() { if (!pending) onClose(); } function reload() { close(); router.refresh(); }
  function revoke() {
    if (error?.reload) return; const data = new FormData(); data.set("id", token.id); data.set("revision", token.revision); data.set("confirmed", "1"); setError(null);
    startTransition(async () => {
      try { const result = await revokeExamToken(data); if (!result.ok) { setError({ message: result.error, reload: result.reload }); return; } onClose(); toast.success(result.message); router.refresh(); }
      catch { setError({ message: "Hasil pencabutan belum dapat dipastikan. Muat ulang status sebelum mencoba lagi.", reload: true }); }
    });
  }
  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md" showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}><DialogHeader><DialogTitle>Cabut token?</DialogTitle><DialogDescription>Token #{token.id} untuk <strong className="break-words text-foreground">{tokenName(token)}</strong> akan segera tidak berlaku. {token.scope === "test" ? "Saat fungsi peserta tersedia, token global yang masih aktif dapat digunakan kembali untuk tes ini." : "Token khusus tes tidak ikut dicabut."}</DialogDescription></DialogHeader>{error && <ErrorNotice error={error} onReload={reload} />}<DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="button" variant="destructive" disabled={pending || Boolean(error?.reload)} onClick={revoke}>{pending ? "Mencabut..." : "Ya, cabut token"}</Button></DialogFooter></DialogContent></Dialog>;
}

function TokenControls({ id, scope, test, slot, now, available, onIssue, onRevoke }: { id: string; scope: AccessTokenScope; test: AccessTokenTestOption | null; slot: AccessTokenRecord | null; now: number; available: boolean; onIssue: (target: IssueTarget) => void; onRevoke: (token: AccessTokenRecord) => void }) {
  const [duration, setDuration] = useState("15"); const active = Boolean(slot && tokenStatus(slot, now) === "Aktif");
  return <div className="flex w-full flex-wrap items-end gap-2 lg:w-auto"><div className="w-32 space-y-1"><span className="text-[11px] font-semibold text-muted-foreground">Durasi token baru</span><DurationSelect id={id} value={duration} onChange={setDuration} /></div><Button type="button" disabled={!available} aria-label={`${active ? "Ganti" : "Aktifkan"} token ${id}`} onClick={() => onIssue({ scope, test, slot, duration })} className="h-10 rounded-xl">{active ? "Ganti token" : "Aktifkan token"}</Button>{active && slot && <Button type="button" variant="outline" className="h-10 rounded-xl text-destructive hover:text-destructive" aria-label={`Cabut token ${slot.id}`} onClick={() => onRevoke(slot)}><ShieldOff className="size-4" /> Cabut</Button>}</div>;
}

export function TokenManager({ tests, current, history, historyPage, historyPages, historyTotal, keyStatus, keyMessage, serverNow }: { tests: AccessTokenTestOption[]; current: AccessTokenRecord[]; history: AccessTokenRecord[]; historyPage: number; historyPages: number; historyTotal: number; keyStatus: TokenKeyStatus; keyMessage: string; serverNow: string }) {
  const router = useRouter(); const [zone, setZone] = useState<Zone>("WIB"); const [issue, setIssue] = useState<IssueTarget | null>(null); const [revoking, setRevoking] = useState<AccessTokenRecord | null>(null);
  const [storageState, setStorageState] = useState<"checking" | "available" | "unavailable" | "invalid">("checking"); const [unresolved, setUnresolved] = useState<string | null>(null);
  const [clock, setClock] = useState({ serverNow, elapsed: 0 });
  useEffect(() => {
    const timer = window.setTimeout(() => { try { const previous = sessionStorage.getItem(PENDING_ISSUE_KEY); const id = previous ? validTokenOperationId(previous) : null; if (previous && !id) { setStorageState("invalid"); return; } if (id) setUnresolved(id); setStorageState("available"); } catch { setStorageState("unavailable"); } }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { const started = performance.now(); const timer = window.setInterval(() => setClock({ serverNow, elapsed: performance.now() - started }), 1000); return () => window.clearInterval(timer); }, [serverNow]);
  const now = Date.parse(serverNow) + (clock.serverNow === serverNow ? clock.elapsed : 0);
  const available = keyStatus === "ready" && storageState === "available" && !unresolved;
  const globalSlot = current.find((token) => token.scope === "global" && !token.revokedAt) ?? null;
  const globalShown = globalSlot ?? current.find((token) => token.scope === "global") ?? null;
  const globalActive = Boolean(globalSlot && tokenStatus(globalSlot, now) === "Aktif");
  const visibleTests = tests.filter((test) => Date.parse(test.endsAt) > now);
  return <>
    <Alert className="mb-5 max-w-4xl rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200"><Info className="size-4" /><AlertTitle className="text-[12px] font-bold">Persiapan admin, belum untuk ujian</AlertTitle><AlertDescription className="text-[12px] leading-5">Login peserta dan pemeriksaan token saat mulai tes belum tersedia. Token khusus aktif kelak mengesampingkan token global; ketika khusus berakhir atau dicabut, global yang masih aktif digunakan kembali.</AlertDescription></Alert>
    {keyStatus !== "ready" && <Alert variant="destructive" role="alert" className="mb-5 max-w-4xl"><Info className="size-4" /><AlertTitle>Kunci token perlu diperiksa</AlertTitle><AlertDescription>{keyMessage} Token lama tetap tercatat; pencabutan token aktif masih tersedia. Lihat panduan kunci sebelum membuat token baru.</AlertDescription></Alert>}
    {(storageState === "unavailable" || storageState === "invalid") && <Alert variant="destructive" role="alert" className="mb-5 max-w-4xl"><Info className="size-4" /><AlertTitle>Penyimpanan sesi browser tidak tersedia</AlertTitle><AlertDescription>Aktifkan penyimpanan sesi dan muat ulang; pembuatan token dinonaktifkan untuk mencegah hasil yang tidak pasti.</AlertDescription></Alert>}
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><p className="text-xs leading-5 text-muted-foreground">Durasi dimulai segera saat diaktifkan. Hitung mundur adalah perkiraan berdasarkan jam server; muat ulang setelah perubahan oleh admin lain.</p><div className="flex items-end gap-2"><div className="w-32 space-y-1"><label htmlFor="token-zone" className="text-[11px] font-semibold text-muted-foreground">Zona waktu</label><select id="token-zone" value={zone} onChange={(event) => setZone(event.target.value as Zone)} className={selectClass}><option value="WIB">WIB (UTC+7)</option><option value="WITA">WITA (UTC+8)</option><option value="WIT">WIT (UTC+9)</option></select></div><Button type="button" variant="outline" onClick={() => router.refresh()} className="h-10 rounded-xl"><RefreshCw className="size-4" /> Muat ulang</Button></div></div>
    <Card role="region" aria-label="Token global" className="mb-6 gap-0 rounded-[18px] border-emerald-200 bg-emerald-50/50 p-5 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/20 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Globe2 className="size-5 text-emerald-700 dark:text-emerald-300" /><h2 className="text-base font-bold">Token Global</h2>{globalShown && <Badge variant={globalActive ? "default" : "secondary"}>{tokenStatus(globalShown, now)}</Badge>}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Untuk tes tanpa token khusus yang aktif.</p></div>{globalShown && <p className="text-xs text-muted-foreground">Token #{globalShown.id}</p>}</div><div className="mt-5 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div className="grid gap-4 sm:grid-cols-2 sm:gap-8"><div><p className="mb-1 text-[11px] font-semibold text-muted-foreground">Kode global</p><TokenCode token={globalShown} label="Kode token global" /></div><div><p className="mb-1 text-[11px] font-semibold text-muted-foreground">Sisa waktu</p><p aria-label="Sisa waktu token global" className="font-mono text-lg font-bold tabular-nums">{remaining(globalSlot, now)}</p>{globalShown && <p className="mt-1 text-[11px] text-muted-foreground">Berakhir {formatTime(globalShown.expiresAt, zone)}</p>}</div></div><TokenControls id="global" scope="global" test={null} slot={globalSlot} now={now} available={available} onIssue={setIssue} onRevoke={setRevoking} /></div></Card>
    <Card className="mb-6 gap-0 overflow-hidden rounded-[18px] py-0 shadow-sm"><div className="border-b border-border p-5 sm:px-6"><div className="flex flex-wrap items-center gap-2"><KeyRound className="size-5 text-amber-700 dark:text-amber-300" /><h2 className="text-base font-bold">Token Khusus Tes</h2><Badge variant="secondary">{visibleTests.length} tes</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">Tes berdasarkan jadwal yang sedang berlangsung atau akan datang. Aktifkan token khusus di baris tes yang diinginkan.</p></div>
      {!visibleTests.length ? <p className="px-6 py-10 text-center text-sm text-muted-foreground">Tidak ada tes berlangsung atau mendatang.</p> : <ul aria-label="Tes berlangsung dan mendatang" className="divide-y divide-border">{visibleTests.map((test) => {
        const matching = current.filter((token) => token.scope === "test" && token.testId === test.id); const slot = matching.find((token) => !token.revokedAt) ?? null; const shown = slot ?? matching[0] ?? null;
        const active = Boolean(slot && tokenStatus(slot, now) === "Aktif"); const scheduledStatus = Date.parse(test.startsAt) <= now ? "Berlangsung (jadwal)" : "Mendatang";
        return <li key={test.id} aria-label={`Tes ${test.id}`} className="p-5 sm:px-6"><div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-bold">{test.name}</h3><Badge variant="outline">{scheduledStatus}</Badge>{shown && <Badge variant={active ? "default" : "secondary"}>{tokenStatus(shown, now)}</Badge>}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">#{test.id} · {test.periodName} · {formatTime(test.startsAt, zone)}–{formatTime(test.endsAt, zone)}</p><div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3"><div><p className="mb-1 text-[11px] font-semibold text-muted-foreground">Kode khusus {shown ? `· token #${shown.id}` : ""}</p><TokenCode token={shown} label={`Kode token tes ${test.id}`} /></div><div><p className="mb-1 text-[11px] font-semibold text-muted-foreground">Sisa waktu khusus</p><p aria-label={`Sisa waktu token tes ${test.id}`} className="font-mono text-base font-bold tabular-nums">{remaining(slot, now)}</p></div></div>{!active && <p className="mt-2 text-xs font-medium text-muted-foreground">{globalActive ? "Menggunakan token global saat fungsi peserta tersedia." : "Tidak ada token aktif untuk tes ini."}</p>}</div><TokenControls id={`tes ${test.id}`} scope="test" test={test} slot={slot} now={now} available={available} onIssue={setIssue} onRevoke={setRevoking} /></div></li>;
      })}</ul>}
    </Card>
    <Card className="gap-0 overflow-hidden rounded-[18px] py-0 shadow-sm"><div className="border-b border-border p-5 sm:px-6"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-bold">Riwayat token</h2><Badge variant="secondary">{historyTotal} catatan</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">Kode baru tetap dapat dilihat setelah kedaluwarsa atau dicabut. Catatan tidak dihapus otomatis; kode lama sebelum fitur ini tidak dapat dipulihkan.</p></div>
      {!history.length ? <p className="px-6 py-10 text-center text-sm text-muted-foreground">Belum ada riwayat token.</p> : <ul aria-label="Riwayat token" className="divide-y divide-border">{history.map((token) => { const status = tokenStatus(token, now); return <li key={token.id} className="flex flex-wrap items-center justify-between gap-4 p-5 sm:px-6"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-bold">{tokenName(token)}</h3><Badge variant={status === "Aktif" ? "default" : "secondary"}>{status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Token #{token.id} · {token.durationMinutes} menit · dibuat oleh {token.createdBy ?? "admin tidak tersedia"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Dibuat {formatTime(token.issuedAt, zone)} · Berakhir {formatTime(token.expiresAt, zone)}</p>{token.revokedAt && <p className="mt-1 text-xs text-muted-foreground">{token.revokedReason === "replaced" ? "Diganti/ditutup" : "Dicabut"} {formatTime(token.revokedAt, zone)}</p>}</div><TokenCode token={token} label={`Kode riwayat token ${token.id}`} /></li>; })}</ul>}
      {historyPages > 1 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-5 text-xs sm:px-6"><span>Halaman {historyPage} dari {historyPages}</span><div className="flex gap-2">{historyPage > 1 && <Button asChild variant="outline" size="sm"><Link href={`/data-tes/token?history=${historyPage - 1}`}><ChevronLeft className="size-4" /> Sebelumnya</Link></Button>}{historyPage < historyPages && <Button asChild variant="outline" size="sm"><Link href={`/data-tes/token?history=${historyPage + 1}`}>Berikutnya <ChevronRight className="size-4" /></Link></Button>}</div></div>}
    </Card>
    {issue && <IssueDialog target={issue} now={now} onClose={() => setIssue(null)} onSuccess={() => { setIssue(null); router.refresh(); }} onUncertain={(id) => { setIssue(null); setUnresolved(id); }} />}
    {unresolved && <UncertainIssueDialog operationId={unresolved} onFinish={() => { setUnresolved(null); router.refresh(); }} />}
    {revoking && <RevokeDialog token={revoking} onClose={() => setRevoking(null)} />}
  </>;
}
