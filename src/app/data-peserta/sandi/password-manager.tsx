"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, Eye, History, Info, KeyRound, RefreshCw, Search, Sparkles, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { revealPassword, savePasswords } from "@/app/data-peserta/sandi/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isNewParticipantPassword, NEW_PARTICIPANT_PASSWORD_ERROR, PARTICIPANT_PASSWORD_BATCH_SIZE } from "@/lib/participant-password-constants.mjs";
import type { IdentityPeriod } from "@/lib/participant-identity-types";
import type { PasswordAudit, PasswordDisplayRow, PasswordKeyStatus, PasswordPageData } from "@/lib/participant-password-types";

const PAGE_SIZE = 25;
const dialogClass = "max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg";

function PasswordEditor({ row, period, onClose }: { row: PasswordDisplayRow; period: IdentityPeriod; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const reset = row.passwordVersion !== null;

  function close() { if (!pending) onClose(); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (mode === "manual") {
      const password = form.get("password");
      if (!isNewParticipantPassword(password)) {
        setError(NEW_PARTICIPANT_PASSWORD_ERROR);
        return;
      }
      if (form.get("passwordConfirmation") !== password) {
        setError("Konfirmasi sandi tidak sama.");
        return;
      }
    }
    form.set("periodId", period.id);
    form.set("candidates", JSON.stringify([row.candidate]));
    form.set("operation", reset ? "reset" : "create");
    form.set("mode", mode);
    setError("");
    startTransition(async () => {
      try {
        const result = await savePasswords(form);
        if (!result.ok) return setError(result.error);
        onClose();
        toast.success(result.message);
        router.refresh();
      } catch {
        setError("Hasil penyimpanan belum dapat dipastikan. Periksa daftar dan sesi, lalu muat ulang sebelum mencoba lagi.");
      }
    });
  }

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">{reset ? "Reset sandi peserta" : "Buat sandi peserta"}</DialogTitle>
        <DialogDescription><strong className="text-foreground">{row.studentName}</strong> · NISN {row.nisn} · {row.classLabel}. Periode <strong className="text-foreground">{period.name}</strong>.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} autoComplete="off" noValidate className="space-y-4 pt-2">
        {error && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        {reset && <Alert variant="destructive"><CircleAlert className="size-4" /><AlertTitle>Sandi lama akan diganti</AlertTitle><AlertDescription>Reset ini tidak dapat dibatalkan. Sandi lama tidak lagi cocok dengan hash yang tersimpan.</AlertDescription></Alert>}
        <fieldset disabled={pending} className="space-y-2"><legend className="text-sm font-semibold">Metode sandi</legend><div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm"><input type="radio" name="passwordMode" value="auto" checked={mode === "auto"} onChange={() => setMode("auto")} className="mt-1 accent-primary" /><span><strong>Otomatis</strong><span className="mt-1 block text-[11px] leading-5 text-muted-foreground">8 huruf kapital acak untuk tiap peserta.</span></span></label>
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm"><input type="radio" name="passwordMode" value="manual" checked={mode === "manual"} onChange={() => setMode("manual")} className="mt-1 accent-primary" /><span><strong>Manual</strong><span className="mt-1 block text-[11px] leading-5 text-muted-foreground">Masukkan sandi sendiri dua kali.</span></span></label>
        </div></fieldset>
        {mode === "manual" && <div className="space-y-4"><div className="space-y-2"><label htmlFor="new-participant-password" className="text-sm font-semibold">Sandi baru</label><Input id="new-participant-password" name="password" type="password" autoComplete="new-password" autoCapitalize="characters" spellCheck={false} maxLength={128} aria-describedby="participant-password-rule" required disabled={pending} className="h-11 rounded-xl" /></div><div className="space-y-2"><label htmlFor="confirm-participant-password" className="text-sm font-semibold">Ulangi sandi baru</label><Input id="confirm-participant-password" name="passwordConfirmation" type="password" autoComplete="new-password" autoCapitalize="characters" spellCheck={false} maxLength={128} aria-describedby="participant-password-rule" required disabled={pending} className="h-11 rounded-xl" /></div><p id="participant-password-rule" className="text-[11px] leading-5 text-muted-foreground">Tepat 8 huruf kapital A–Z, tanpa angka, spasi, atau simbol. Sandi lama tetap berlaku sampai di-reset.</p></div>}
        <p className="rounded-xl bg-muted/40 p-3 text-[11px] leading-5 text-muted-foreground">Sandi tidak ditampilkan setelah disimpan. Gunakan tombol <strong>Lihat sandi</strong> jika diperlukan; setiap penampilan berhasil dicatat.</p>
        <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : reset ? "Ya, reset sandi" : "Buat sandi"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function GenerateDialog({ data, onClose }: { data: PasswordPageData; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const { selected, batch } = data;
  function close() { if (!pending) onClose(); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !batch) return;
    const form = new FormData();
    form.set("periodId", selected.id);
    form.set("candidates", JSON.stringify(batch.candidates));
    form.set("operation", "create");
    form.set("mode", "auto");
    setError("");
    startTransition(async () => {
      try {
        const result = await savePasswords(form);
        if (!result.ok) return setError(result.error);
        onClose();
        toast.success(result.message);
        router.refresh();
      } catch {
        setError("Hasil penyimpanan belum dapat dipastikan. Periksa daftar dan sesi, lalu muat ulang sebelum mencoba lagi.");
      }
    });
  }
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
      <DialogHeader><DialogTitle className="text-lg font-bold">Buat sandi otomatis?</DialogTitle><DialogDescription>Untuk <strong className="text-foreground">{batch?.candidates.length ?? 0} peserta</strong> yang memiliki identitas dan kelas aktif, tetapi belum memiliki sandi pada periode <strong className="text-foreground">{selected?.name}</strong>.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4 pt-2">
        {error && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        {batch && batch.totalMissing > batch.candidates.length && <Alert><Info className="size-4" /><AlertTitle>Batch pertama</AlertTitle><AlertDescription>{batch.candidates.length} dari {batch.totalMissing} peserta diproses menurut urutan nama. Setelah selesai, ulangi untuk sisanya.</AlertDescription></Alert>}
        <p className="rounded-xl bg-muted/40 p-3 text-[11px] leading-5 text-muted-foreground">Sandi acak dibuat secara terpisah untuk setiap peserta. Maksimal {PARTICIPANT_PASSWORD_BATCH_SIZE} peserta per batch; pencarian tidak memengaruhi pilihan. Sandi yang sudah ada tidak ditimpa. Jika data berubah, seluruh batch dibatalkan.</p>
        <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="submit" disabled={pending || !batch}>{pending ? "Membuat..." : "Ya, buat sandi"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function RevealDialog({ row, period, onClose }: { row: PasswordDisplayRow; period: IdentityPeriod; onClose: () => void }) {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const secretOutput = useRef<HTMLOutputElement>(null);

  useEffect(() => {
    const hide = () => {
      if (!secretOutput.current) return;
      // Kosongkan DOM seketika sebelum browser menyimpan halaman dalam bfcache.
      secretOutput.current.textContent = "";
      setSecret(null);
      setNotice("Sandi disembunyikan. Tampilkan kembali jika diperlukan; akses baru akan dicatat.");
    };
    const visibility = () => { if (document.visibilityState !== "visible") hide(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); };
  }, []);

  useEffect(() => {
    if (!secret) return;
    const timer = window.setTimeout(() => {
      if (secretOutput.current) secretOutput.current.textContent = "";
      setSecret(null);
      setNotice("Sandi disembunyikan. Tampilkan kembali jika diperlukan; akses baru akan dicatat.");
    }, 60_000);
    return () => window.clearTimeout(timer);
  }, [secret]);

  function close() {
    if (pending) return;
    setSecret(null);
    onClose();
    router.refresh();
  }
  function reveal() {
    const form = new FormData();
    form.set("periodId", period.id);
    form.set("candidates", JSON.stringify([row.candidate]));
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        const result = await revealPassword(form);
        if (!result.ok) return setError(result.error);
        if (document.visibilityState !== "visible") {
          setNotice("Akses dicatat, tetapi sandi tidak ditampilkan karena halaman tidak aktif. Tampilkan kembali jika diperlukan.");
          return;
        }
        setSecret(result.password);
      } catch {
        setError("Sandi belum dapat ditampilkan. Periksa sesi dan daftar, lalu muat ulang sebelum mencoba lagi.");
      }
    });
  }
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
      <DialogHeader><DialogTitle className="text-lg font-bold">Lihat sandi peserta</DialogTitle><DialogDescription><strong className="text-foreground">{row.studentName}</strong> · NISN {row.nisn} · {row.classLabel}. Periode <strong className="text-foreground">{period.name}</strong>.</DialogDescription></DialogHeader>
      <div className="space-y-4 pt-2">
        {error && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        {notice && <p role="status" className="text-xs leading-5 text-muted-foreground">{notice}</p>}
        <p className="text-xs leading-6 text-muted-foreground">Setiap penampilan yang berhasil dicatat bersama admin, peserta, dan waktu—tanpa nilai sandi. Pastikan layar tidak dilihat pihak yang tidak berwenang.</p>
        {secret === null ? <div aria-label="Sandi tersamarkan" className="rounded-xl border bg-muted/40 p-4 font-mono text-base tracking-[0.15em]">••••••••</div> : <output ref={secretOutput} aria-label="Sandi peserta" className="block min-w-0 rounded-xl border border-amber-300 bg-amber-50 p-4 font-mono text-sm break-all whitespace-pre-wrap text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">{secret}</output>}
        <p className="text-[11px] leading-5 text-muted-foreground">Sandi akan disembunyikan saat dialog ditutup, halaman tidak aktif, atau setelah 60 detik. Jangan simpan pada perangkat bersama.</p>
        <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={close}>Tutup</Button>{secret === null && <Button type="button" disabled={pending} onClick={reveal}>{pending ? "Memeriksa..." : "Tampilkan sandi"}</Button>}</DialogFooter>
      </div>
    </DialogContent>
  </Dialog>;
}

const keyMessages: Record<Exclude<PasswordKeyStatus, "ready">, { title: string; detail: string }> = {
  missing: { title: "Kunci belum dikonfigurasi", detail: "Minta pengelola mengatur path kunci lama yang sesuai. Jangan membuat kunci pengganti jika database sudah memiliki pengikat atau sandi; lihat README." },
  invalid: { title: "File kunci tidak dapat digunakan", detail: "Periksa lokasi di luar proyek, format, dan izin file di server. Jangan mengganti kunci lama sembarangan." },
  mismatch: { title: "Kunci tidak cocok dengan database", detail: "Pulihkan kunci yang benar dari cadangan terpisah. Pembuatan, reset, dan penampilan sandi dinonaktifkan." },
  inconsistent: { title: "Pengikat kunci tidak tersedia", detail: "Pulihkan database dan kunci yang sesuai dari cadangan. Jangan menghapus atau mengganti data sandi sembarangan." },
};
const auditLabels: Record<PasswordAudit["event"], string> = {
  create_manual: "Sandi dibuat manual", create_auto: "Sandi dibuat otomatis", reset_manual: "Sandi di-reset manual", reset_auto: "Sandi di-reset otomatis", reveal: "Sandi ditampilkan",
};

export function PasswordManager({ data }: { data: PasswordPageData }) {
  const router = useRouter();
  const [changingPeriod, startChangingPeriod] = useTransition();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<PasswordDisplayRow | null>(null);
  const [revealing, setRevealing] = useState<PasswordDisplayRow | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const { selected, rows, batch } = data;
  const ready = data.keyStatus === "ready";
  const normalized = query.trim().toLowerCase();
  const visible = rows.filter((row) => !normalized || [row.studentName, row.nisn, row.classLabel ?? "", row.participantNumber, row.username].some((value) => value.toLowerCase().includes(normalized)));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const current = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const active = rows.filter((row) => row.placementId).length;
  const assigned = rows.filter((row) => row.placementId && row.passwordVersion).length;
  const missing = rows.filter((row) => row.placementId && !row.passwordVersion).length;
  const inactive = rows.filter((row) => !row.placementId).length;

  return <div className="max-w-6xl space-y-5">
    <Alert className="rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200"><Info className="size-4 text-[#727fc8] dark:text-indigo-300" /><AlertTitle className="text-[12px] font-bold">Sandi per periode</AlertTitle><AlertDescription className="mt-0.5 text-[12px] leading-5 text-[#6873a0] dark:text-indigo-200/70">Hanya admin yang dapat membuat, reset, atau meminta tampilan sandi. Identitas dan kelas aktif diperlukan. Reset sandi mengakhiri sesi peserta; kartu belum tersedia.</AlertDescription></Alert>
    {data.keyStatus !== "ready" && <Alert variant="destructive" role="alert" className="rounded-2xl"><CircleAlert className="size-4" /><AlertTitle>{keyMessages[data.keyStatus].title}</AlertTitle><AlertDescription>{keyMessages[data.keyStatus].detail}</AlertDescription></Alert>}
    {data.selectionMissing && <Alert variant="destructive" role="alert" className="rounded-2xl"><CircleAlert className="size-4" /><AlertTitle>Periode tidak ditemukan</AlertTitle><AlertDescription>Pilih periode yang masih tersedia.</AlertDescription></Alert>}
    <Card className="gap-0 rounded-[18px] p-5 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)] sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4"><div className="w-full min-w-0 max-w-lg space-y-2"><label htmlFor="password-period" className="text-sm font-semibold">Periode <span className="text-destructive">*</span></label><Select value={selected?.id ?? ""} onValueChange={(value) => startChangingPeriod(() => router.push(`/data-peserta/sandi?periode=${encodeURIComponent(value)}`))} disabled={changingPeriod || data.periods.length === 0}><SelectTrigger id="password-period" aria-required="true" className="h-11! w-full min-w-0 rounded-xl"><SelectValue placeholder="Pilih periode" /></SelectTrigger><SelectContent position="popper">{data.periods.map((period) => <SelectItem key={period.id} value={period.id}>{period.name} · {period.startDate}</SelectItem>)}</SelectContent></Select></div><Button type="button" disabled={changingPeriod || !batch || !ready} onClick={() => setGenerateOpen(true)} className="h-10 w-full rounded-xl font-semibold sm:w-auto"><Sparkles className="size-4" /> Buat otomatis</Button></div>
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">Buat <Link href="/data-peserta/identitas" className="font-semibold text-primary underline">identitas peserta</Link> terlebih dahulu. Pembuatan otomatis tidak mengubah sandi yang sudah ada.</p>
    </Card>
    {selected && <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[{ label: "Identitas kelas aktif", value: active }, { label: "Sudah bersandi", value: assigned }, { label: "Belum bersandi", value: missing }, { label: "Tanpa kelas aktif", value: inactive }].map((tile) => <div key={tile.label} className="min-w-0 rounded-2xl border border-border bg-card px-4 py-3"><p className="text-[10px] font-semibold text-muted-foreground">{tile.label}</p><p className="mt-1 text-lg font-bold tabular-nums">{tile.value}</p></div>)}</div>
      <Card className="min-w-0 gap-0 overflow-hidden rounded-[18px] ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border p-5 sm:px-6"><div><h2 className="text-[15px] font-bold">Daftar sandi</h2><p className="mt-1 text-[12px] leading-5 text-muted-foreground">Periode <strong>{selected.name}</strong> · mulai {selected.startDate}</p></div><div className="w-full max-w-xs space-y-2"><label htmlFor="password-search" className="block text-[11px] font-semibold">Cari peserta</label><div className="relative"><Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" /><Input id="password-search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Nama, NISN, kelas, nomor, username" className="h-10 rounded-xl pl-9 text-xs" /></div></div></div>
        {current.length === 0 ? <div className="flex flex-col items-center px-6 py-12 text-center"><UsersRound className="size-7 text-muted-foreground" /><h3 className="mt-4 text-sm font-bold">{rows.length ? "Peserta tidak ditemukan" : "Belum ada identitas pada periode ini"}</h3><p className="mt-1.5 text-[12px] leading-6 text-muted-foreground">{rows.length ? "Coba kata kunci lain." : <>Atur nomor dan username pada <Link href="/data-peserta/identitas" className="font-semibold text-primary underline">Identitas Peserta</Link>.</>}</p></div> : <ul aria-label="Daftar sandi peserta" className="divide-y divide-border">{current.map((row) => <li key={row.identityId} className="flex min-w-0 flex-col gap-3 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:gap-5"><div className="flex min-w-0 flex-1 items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><KeyRound className="size-[18px]" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-[13px] font-bold">{row.studentName}</h3><Badge variant={row.placementId ? "secondary" : "destructive"} className="rounded-full text-[10px]">{row.placementId ? (row.passwordVersion ? "Sudah bersandi" : "Belum bersandi") : "Kelas tidak aktif"}</Badge></div><p className="mt-1 break-words text-[11px] text-muted-foreground">NISN {row.nisn} · {row.classLabel ?? "Tidak ada kelas aktif"}</p><p className="mt-1 break-words text-[11px] leading-5 text-muted-foreground">Nomor: <strong className="text-foreground">{row.participantNumber}</strong> · Username: <strong className="text-foreground">{row.username}</strong></p><p className="mt-1 text-[11px] text-muted-foreground">Sandi: <span aria-label={row.passwordVersion ? "Tersamarkan" : "Belum dibuat"} className="font-mono tracking-wider">{row.passwordVersion ? "••••••••" : "—"}</span></p>{!row.placementId && <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Sandi tetap disimpan. Tempatkan kembali siswa untuk mengelola atau melihatnya.</p>}</div></div><div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"><Button type="button" variant="outline" size="sm" disabled={changingPeriod || !row.placementId || !row.passwordVersion || !ready} aria-label={`Lihat sandi ${row.studentName} ${row.nisn}`} onClick={() => setRevealing(row)} className="w-full rounded-lg sm:w-auto"><Eye className="size-3.5" /> Lihat sandi</Button><Button type="button" variant="outline" size="sm" disabled={changingPeriod || !row.placementId || !ready} aria-label={`${row.passwordVersion ? "Reset" : "Buat"} sandi ${row.studentName} ${row.nisn}`} onClick={() => setEditing(row)} className="w-full rounded-lg sm:w-auto">{row.passwordVersion ? <RefreshCw className="size-3.5" /> : <KeyRound className="size-3.5" />} {row.passwordVersion ? "Reset sandi" : "Buat sandi"}</Button></div></li>)}</ul>}
        {visible.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6"><p className="text-[11px] text-muted-foreground">Menampilkan {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, visible.length)} dari {visible.length} peserta</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Sebelumnya</Button><Button type="button" size="sm" variant="outline" disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>Berikutnya</Button></div></div>}
      </Card>
      <Card className="gap-0 rounded-[18px] p-5 ring-1 ring-border sm:p-6"><div className="flex items-start gap-3"><History className="mt-0.5 size-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><h2 className="text-[15px] font-bold">Riwayat tindakan sandi</h2><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Maksimal 20 tindakan terbaru di periode ini, waktu UTC. Catatan tidak berisi sandi; bukan log kebal-ubah terhadap pengelola database.</p>{data.audit.length ? <ul aria-label="Riwayat tindakan sandi" className="mt-3 divide-y divide-border">{data.audit.map((entry) => <li key={entry.id} className="break-words py-2 text-[11px] leading-5"><strong>{auditLabels[entry.event]}</strong> · {entry.studentName} · NISN {entry.nisn}<span className="block text-muted-foreground">Admin {entry.adminUsername} · {entry.occurredAt}</span></li>)}</ul> : <p className="mt-3 text-[11px] text-muted-foreground">Belum ada tindakan sandi pada periode ini.</p>}</div></div></Card>
    </>}
    {editing && selected && <PasswordEditor key={`${editing.identityId}-${editing.passwordVersion ?? "new"}`} row={editing} period={selected} onClose={() => setEditing(null)} />}
    {revealing && selected && <RevealDialog key={`${revealing.identityId}-${revealing.passwordVersion}`} row={revealing} period={selected} onClose={() => setRevealing(null)} />}
    {generateOpen && <GenerateDialog data={data} onClose={() => setGenerateOpen(false)} />}
  </div>;
}
