"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, Eye, History, IdCard, Info, KeyRound, LockKeyhole, Pencil, RefreshCw, Search, Sparkles, UnlockKeyhole, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { unlockLogin } from "@/app/data-peserta/akun/actions";
import { IdentityEditor, IdentityGenerateDialog } from "@/app/data-peserta/identitas/identity-manager";
import { PasswordEditor, PasswordGenerateDialog, PasswordRevealDialog, auditLabels, keyMessages } from "@/app/data-peserta/sandi/password-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AccountPageData, LoginLock } from "@/lib/participant-account-types";
import type { IdentityPeriod, ParticipantIdentityRow } from "@/lib/participant-identity-types";
import type { PasswordDisplayRow } from "@/lib/participant-password-types";

const PAGE_SIZE = 25;
const AUDIT_PAGE_SIZE = 5;

type UnlockSelection = { row: ParticipantIdentityRow; lock: LoginLock };

function UnlockDialog({ selection, period, onClose }: { selection: UnlockSelection; period: IdentityPeriod; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const { row, lock } = selection;
  function close() { if (!pending) onClose(); }
  function confirm() {
    const form = new FormData();
    form.set("periodId", period.id);
    for (const [name, value] of Object.entries(lock)) form.set(name, value);
    setError("");
    startTransition(async () => {
      try {
        const result = await unlockLogin(form);
        if (!result.ok) { setError(result.error); return; }
        onClose(); toast.success(result.message); router.refresh();
      } catch {
        setError("Hasil pembukaan kunci belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar.");
      }
    });
  }
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg" showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Buka kunci login peserta?</DialogTitle><DialogDescription><strong className="text-foreground">{row.studentName}</strong> · NISN {row.nisn} · username <strong className="text-foreground">{lock.username}</strong> · periode <strong className="text-foreground">{period.name}</strong>.</DialogDescription></DialogHeader>
      <Alert role="note"><Info className="size-4" /><AlertTitle>Periksa identitas peserta</AlertTitle><AlertDescription>Kunci login untuk peserta dan periode ini akan dibuka. Sandi, penempatan kelas, sesi peserta, dan pembatas global tidak diubah. Tindakan dicatat bersama admin dan waktunya.</AlertDescription></Alert>
      {error && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="button" disabled={pending} onClick={confirm}>{pending ? "Memproses..." : "Ya, buka kunci"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function AccountManager({
  data,
  canManageAccounts,
  canManagePasswords,
}: {
  data: AccountPageData;
  canManageAccounts: boolean;
  canManagePasswords: boolean;
}) {
  const router = useRouter();
  const [changing, startChanging] = useTransition();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [auditPageState, setAuditPageState] = useState<{ periodId: string | null; page: number }>({ periodId: null, page: 0 });
  const [identityEditing, setIdentityEditing] = useState<ParticipantIdentityRow | null>(null);
  const [passwordEditing, setPasswordEditing] = useState<PasswordDisplayRow | null>(null);
  const [revealing, setRevealing] = useState<PasswordDisplayRow | null>(null);
  const [unlocking, setUnlocking] = useState<UnlockSelection | null>(null);
  const [identityGenerateOpen, setIdentityGenerateOpen] = useState(false);
  const [passwordGenerateOpen, setPasswordGenerateOpen] = useState(false);
  const { identities, passwords, locks } = data;
  const { selected, rows } = identities;
  const ready = passwords.keyStatus === "ready";
  const passwordsById = new Map(passwords.rows.map((row) => [row.identityId, row]));
  const locksById = new Map(locks.map((lock) => [lock.identityId, lock]));
  const normalized = query.trim().toLowerCase();
  const visible = rows.filter((row) => !normalized || [row.studentName, row.nisn, row.classLabel ?? "", row.participantNumber ?? "", row.username ?? ""].some((value) => value.toLowerCase().includes(normalized)));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const current = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const active = rows.filter((row) => row.placementId).length;
  const assigned = rows.filter((row) => row.placementId && row.identityId).length;
  const withPassword = passwords.rows.filter((row) => row.placementId && row.passwordVersion).length;
  const auditPageCount = Math.max(1, Math.ceil(passwords.audit.length / AUDIT_PAGE_SIZE));
  const rawAuditPage = auditPageState.periodId === (selected?.id ?? null) ? auditPageState.page : 0;
  const safeAuditPage = Math.min(Math.max(0, rawAuditPage), auditPageCount - 1);
  const currentAudit = passwords.audit.slice(safeAuditPage * AUDIT_PAGE_SIZE, (safeAuditPage + 1) * AUDIT_PAGE_SIZE);

  return <div className="max-w-6xl space-y-5">
    <Alert className="rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200"><Info className="size-4 text-[#727fc8] dark:text-indigo-300" /><AlertTitle className="text-[12px] font-bold">Akun peserta per periode</AlertTitle><AlertDescription className="mt-0.5 text-[12px] leading-5 text-[#6873a0] dark:text-indigo-200/70">Atur identitas, sandi, dan buka kunci login dari daftar yang sama. Periode login dipilih terpisah oleh admin di <Link href="/data-peserta/periode" className="font-semibold underline">Periode Ujian</Link>. Mengubah identitas atau reset sandi mengakhiri sesi peserta; membuka kunci tidak.</AlertDescription></Alert>
    {passwords.keyStatus !== "ready" && <Alert variant="destructive" role="alert" className="rounded-2xl"><CircleAlert className="size-4" /><AlertTitle>{keyMessages[passwords.keyStatus].title}</AlertTitle><AlertDescription>{keyMessages[passwords.keyStatus].detail} Pembukaan kunci login tetap dapat digunakan tanpa mengubah sandi.</AlertDescription></Alert>}
    {identities.selectionMissing && <Alert variant="destructive" role="alert" className="rounded-2xl"><CircleAlert className="size-4" /><AlertTitle>Periode tidak ditemukan</AlertTitle><AlertDescription>Pilih periode yang masih tersedia.</AlertDescription></Alert>}
    <Card className="gap-0 rounded-[18px] p-5 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)] sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="w-full min-w-0 max-w-lg space-y-2"><label htmlFor="account-period" className="text-sm font-semibold">Periode <span className="text-destructive">*</span></label><Select value={selected?.id ?? ""} onValueChange={(value) => startChanging(() => router.push(`/data-peserta/akun?periode=${encodeURIComponent(value)}`))} disabled={changing || identities.periods.length === 0}><SelectTrigger id="account-period" aria-required="true" className="h-11! w-full min-w-0 rounded-xl"><SelectValue placeholder="Pilih periode" /></SelectTrigger><SelectContent position="popper">{identities.periods.map((period) => <SelectItem key={period.id} value={period.id}>{period.name} · {period.startDate}</SelectItem>)}</SelectContent></Select></div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {canManageAccounts && <Button type="button" variant="outline" disabled={changing || !identities.batch} onClick={() => setIdentityGenerateOpen(true)} className="grow rounded-xl sm:grow-0"><Sparkles className="size-4" /> Buat identitas otomatis</Button>}
          {canManagePasswords && <Button type="button" disabled={changing || !passwords.batch || !ready} onClick={() => setPasswordGenerateOpen(true)} className="grow rounded-xl sm:grow-0"><KeyRound className="size-4" /> Buat sandi otomatis</Button>}
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{identities.periods.length ? "Pilih periode untuk menampilkan akun. Pembuatan otomatis hanya mengisi data yang belum ada dan tidak dipengaruhi pencarian." : <>Buat <Link href="/data-peserta/periode" className="font-semibold text-primary underline">periode</Link>, lalu atur <Link href="/data-peserta/siswa" className="font-semibold text-primary underline">penempatan siswa</Link>.</>}</p>
    </Card>
    {selected && <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[{ label: "Siswa kelas aktif", value: active }, { label: "Sudah beridentitas", value: assigned }, { label: "Sudah bersandi", value: withPassword }, { label: "Login terkunci", value: locks.length }].map((tile) => <div key={tile.label} className="min-w-0 rounded-2xl border border-border bg-card px-4 py-3"><p className="text-[10px] font-semibold text-muted-foreground">{tile.label}</p><p className="mt-1 text-lg font-bold tabular-nums">{tile.value}</p></div>)}</div>
      <Card className="min-w-0 gap-0 overflow-hidden rounded-[18px] ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border p-5 sm:px-6">
          <div><h2 className="text-[15px] font-bold">Daftar akun peserta</h2><p className="mt-1 text-[12px] leading-5 text-muted-foreground">Periode <strong>{selected.name}</strong> · mulai {selected.startDate}</p></div>
          <div className="flex w-full max-w-lg flex-wrap items-end gap-2"><div className="min-w-0 flex-1 space-y-2"><label htmlFor="account-search" className="block text-[11px] font-semibold">Cari peserta</label><div className="relative"><Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" /><Input id="account-search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Nama, NISN, kelas, nomor, username" className="h-10 rounded-xl pl-9 text-xs" /></div></div><Button type="button" variant="outline" disabled={changing} onClick={() => startChanging(() => router.refresh())} className="h-10 rounded-xl"><RefreshCw className="size-4" /> Muat ulang</Button></div>
        </div>
        <p className="border-b border-border px-5 py-3 text-[11px] leading-5 text-muted-foreground sm:px-6">Status penguncian diperbarui saat daftar dimuat ulang. Sandi tersamarkan; pembukaan dan perubahan sandi tetap dicatat.</p>
        {current.length === 0 ? <div className="flex flex-col items-center px-6 py-12 text-center"><UsersRound className="size-7 text-muted-foreground" /><h3 className="mt-4 text-sm font-bold">{rows.length ? "Peserta tidak ditemukan" : "Belum ada siswa pada periode ini"}</h3><p className="mt-1.5 text-[12px] leading-6 text-muted-foreground">{rows.length ? "Coba kata kunci lain." : <>Atur kelas siswa pada <Link href="/data-peserta/siswa" className="font-semibold text-primary underline">Data Siswa</Link> atau gunakan impor Excel.</>}</p></div> : <ul aria-label="Daftar akun peserta" className="divide-y divide-border">{current.map((row) => {
          const password = row.identityId ? passwordsById.get(row.identityId) : undefined;
          const lock = row.identityId ? locksById.get(row.identityId) : undefined;
          return <li key={row.studentId} className="flex min-w-0 flex-col gap-3 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:gap-5">
            <div className="flex min-w-0 flex-1 items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><IdCard className="size-[18px]" /></span><div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-[13px] font-bold">{row.studentName}</h3><Badge variant={row.placementId ? "secondary" : "destructive"} className="rounded-full text-[10px]">{row.placementId ? (row.identityId ? "Beridentitas" : "Belum beridentitas") : "Kelas tidak aktif"}</Badge><Badge variant="secondary" className="rounded-full text-[10px]">{password?.passwordVersion ? "Sudah bersandi" : "Belum bersandi"}</Badge>{lock && <Badge variant="destructive" className="rounded-full text-[10px]"><LockKeyhole className="mr-1 size-3" /> Login terkunci</Badge>}</div>
              <p className="mt-1 break-words text-[11px] text-muted-foreground">NISN {row.nisn} · {row.classLabel ?? "Tidak ada kelas aktif"}</p><p className="mt-1 break-words text-[11px] leading-5 text-muted-foreground">Nomor: <strong className="text-foreground">{row.participantNumber ?? "—"}</strong> · Username: <strong className="text-foreground">{row.username ?? "—"}</strong></p>
              <p className="mt-1 text-[11px] text-muted-foreground">Sandi: <span aria-label={password?.passwordVersion ? "Tersamarkan" : "Belum dibuat"} className="font-mono tracking-wider">{password?.passwordVersion ? "••••••••" : "—"}</span></p>
              {lock && <p className="mt-1 text-[11px] leading-5 text-destructive">Terkunci hingga {lock.lockedUntil.replace("T", " ").replace(/\.\d{6}Z$/, " UTC")}, kecuali dibuka admin.</p>}
              {!row.placementId && <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Identitas dan sandi tetap disimpan. Tempatkan kembali siswa untuk mengubahnya atau masuk.</p>}
            </div></div>
            <div className="flex w-full flex-wrap gap-2 lg:max-w-[440px] lg:justify-end">
              {canManageAccounts && <Button type="button" variant="outline" size="sm" disabled={changing || !row.placementId} aria-label={`${row.identityId ? "Ubah" : "Atur"} identitas ${row.studentName} ${row.nisn}`} onClick={() => setIdentityEditing(row)} className="grow rounded-lg sm:grow-0"><Pencil className="size-3.5" /> {row.identityId ? "Ubah identitas" : "Atur identitas"}</Button>}
              {canManagePasswords && password && <><Button type="button" variant="outline" size="sm" disabled={changing || !password.placementId || !password.passwordVersion || !ready} aria-label={`Lihat sandi ${row.studentName} ${row.nisn}`} onClick={() => setRevealing(password)} className="grow rounded-lg sm:grow-0"><Eye className="size-3.5" /> Lihat sandi</Button><Button type="button" variant="outline" size="sm" disabled={changing || !password.placementId || !ready} aria-label={`${password.passwordVersion ? "Reset" : "Buat"} sandi ${row.studentName} ${row.nisn}`} onClick={() => setPasswordEditing(password)} className="grow rounded-lg sm:grow-0"><KeyRound className="size-3.5" /> {password.passwordVersion ? "Reset sandi" : "Buat sandi"}</Button></>}
              {canManageAccounts && lock && <Button type="button" variant="outline" size="sm" disabled={changing} aria-label={`Buka kunci login ${row.studentName} ${row.nisn}`} onClick={() => setUnlocking({ row, lock })} className="grow rounded-lg text-amber-800 sm:grow-0 dark:text-amber-300"><UnlockKeyhole className="size-3.5" /> Buka kunci login</Button>}
            </div>
          </li>;
        })}</ul>}
        {visible.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6"><p className="text-[11px] text-muted-foreground">Menampilkan {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, visible.length)} dari {visible.length} peserta</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Sebelumnya</Button><Button type="button" size="sm" variant="outline" disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>Berikutnya</Button></div></div>}
      </Card>
      <Card className="gap-0 rounded-[18px] p-5 ring-1 ring-border sm:p-6"><div className="flex items-start gap-3"><History className="mt-0.5 size-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-[15px] font-bold">Riwayat tindakan akun</h2>{passwords.audit.length > 0 && <Badge variant="secondary" className="rounded-full text-[10px]">{passwords.audit.length} tindakan</Badge>}</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Hingga 200 tindakan sandi atau buka kunci terbaru di periode ini, waktu UTC. Catatan tidak berisi sandi dan belum kebal-ubah terhadap pengelola database.</p>{passwords.audit.length ? <>
        <ul aria-label="Riwayat tindakan akun" className="mt-3 divide-y divide-border">{currentAudit.map((entry) => <li key={entry.id} className="break-words py-2 text-[11px] leading-5"><strong>{auditLabels[entry.event]}</strong> · {entry.studentName} · NISN {entry.nisn}<span className="block text-muted-foreground">Admin {entry.adminUsername} · {entry.occurredAt}</span></li>)}</ul>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">Menampilkan {safeAuditPage * AUDIT_PAGE_SIZE + 1}–{Math.min((safeAuditPage + 1) * AUDIT_PAGE_SIZE, passwords.audit.length)} dari {passwords.audit.length} tindakan (hal. {safeAuditPage + 1}/{auditPageCount})</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={safeAuditPage === 0} onClick={() => setAuditPageState({ periodId: selected.id, page: safeAuditPage - 1 })}>Sebelumnya</Button>
            <Button type="button" size="sm" variant="outline" disabled={safeAuditPage + 1 >= auditPageCount} onClick={() => setAuditPageState({ periodId: selected.id, page: safeAuditPage + 1 })}>Berikutnya</Button>
          </div>
        </div>
      </> : <p className="mt-3 text-[11px] text-muted-foreground">Belum ada tindakan akun pada periode ini.</p>}</div></div></Card>
    </>}
    {identityEditing && selected && <IdentityEditor row={identityEditing} period={selected} onClose={() => setIdentityEditing(null)} />}
    {passwordEditing && selected && <PasswordEditor key={`${passwordEditing.identityId}-${passwordEditing.passwordVersion ?? "new"}`} row={passwordEditing} period={selected} onClose={() => setPasswordEditing(null)} />}
    {revealing && selected && <PasswordRevealDialog key={`${revealing.identityId}-${revealing.passwordVersion}`} row={revealing} period={selected} onClose={() => setRevealing(null)} />}
    {unlocking && selected && <UnlockDialog selection={unlocking} period={selected} onClose={() => setUnlocking(null)} />}
    <IdentityGenerateDialog open={identityGenerateOpen} onClose={() => setIdentityGenerateOpen(false)} period={selected} batch={identities.batch} />
    {passwordGenerateOpen && <PasswordGenerateDialog data={passwords} onClose={() => setPasswordGenerateOpen(false)} />}
  </div>;
}
