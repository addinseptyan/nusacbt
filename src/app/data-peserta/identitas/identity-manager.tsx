"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, IdCard, Info, Pencil, Search, Sparkles, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { generateIdentities, saveIdentity } from "@/app/data-peserta/identitas/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_IDENTITY_PATTERN } from "@/lib/participant-identity-constants.mjs";
import type { IdentityBatch, IdentityPageData, IdentityPeriod, ParticipantIdentityRow } from "@/lib/participant-identity-types";

const PAGE_SIZE = 25;
const dialogClass = "max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg";

function IdentityEditor({ row, period, onClose }: { row: ParticipantIdentityRow | null; period: IdentityPeriod | null; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setError("");
    onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!row || !period || !row.placementId || !row.classId || row.classLabel === null) return;
    const form = new FormData(event.currentTarget);
    form.set("studentId", row.studentId);
    form.set("studentVersion", row.studentVersion);
    form.set("studentName", row.studentName);
    form.set("nisn", row.nisn);
    form.set("periodId", period.id);
    form.set("periodVersion", period.version);
    form.set("periodName", period.name);
    form.set("periodStartDate", period.startDate);
    form.set("placementId", row.placementId);
    form.set("classId", row.classId);
    form.set("classLabel", row.classLabel);
    form.set("identityId", row.identityId ?? "");
    form.set("identityVersion", row.identityVersion ?? "");
    form.set("expectedParticipantNumber", row.participantNumber ?? "");
    form.set("expectedUsername", row.username ?? "");
    setError("");
    startTransition(async () => {
      try {
        const result = await saveIdentity(form);
        if (!result.ok) return setError(result.error);
        onClose();
        toast.success(result.message);
        router.refresh();
      } catch {
        setError("Hasil penyimpanan belum dapat dipastikan. Periksa daftar dan sesi, lalu muat ulang sebelum mencoba lagi.");
      }
    });
  }

  return (
    <Dialog open={row !== null} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{row?.identityId ? "Ubah identitas peserta" : "Atur identitas peserta"}</DialogTitle>
          <DialogDescription><strong className="text-foreground">{row?.studentName}</strong> · NISN {row?.nisn} · {row?.classLabel}. Berlaku pada periode <strong className="text-foreground">{period?.name}</strong>.</DialogDescription>
        </DialogHeader>
        <form key={`${row?.studentId ?? "-"}-${row?.identityVersion ?? "baru"}`} onSubmit={submit} className="space-y-4 pt-2">
          {error && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-2"><label htmlFor="participant-number" className="text-sm font-semibold">Nomor peserta <span className="text-destructive">*</span></label><Input id="participant-number" name="participantNumber" type="text" maxLength={64} defaultValue={row?.participantNumber ?? ""} autoComplete="off" spellCheck={false} required disabled={pending} className="h-11 rounded-xl" /><p className="text-[11px] leading-5 text-muted-foreground">1–64 karakter; nol di depan tetap disimpan. Kolom Nomor Excel bukan nomor peserta.</p></div>
          <div className="space-y-2"><label htmlFor="participant-username" className="text-sm font-semibold">Username <span className="text-destructive">*</span></label><Input id="participant-username" name="username" type="text" maxLength={64} minLength={3} defaultValue={row?.username ?? ""} autoComplete="off" spellCheck={false} required disabled={pending} className="h-11 rounded-xl" /><p className="text-[11px] leading-5 text-muted-foreground">3–64 karakter. Nomor dan username boleh sama atau berbeda.</p></div>
          <p className="rounded-xl bg-muted/40 p-3 text-[11px] leading-5 text-muted-foreground">Gunakan huruf atau angka di awal; berikutnya boleh huruf, angka, titik, garis bawah, atau tanda hubung. Keduanya unik dalam periode ini tanpa membedakan huruf besar/kecil.</p>
          <DialogFooter className="rounded-b-2xl"><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan identitas"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GenerateDialog({ open, onClose, period, batch }: { open: boolean; onClose: () => void; period: IdentityPeriod | null; batch: IdentityBatch | null }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setError("");
    onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!period || !batch) return;
    const form = new FormData(event.currentTarget);
    form.set("periodId", period.id);
    form.set("studentIds", JSON.stringify(batch.studentIds));
    form.set("batchToken", batch.token);
    setError("");
    startTransition(async () => {
      try {
        const result = await generateIdentities(form);
        if (!result.ok) return setError(result.error);
        onClose();
        toast.success(result.message);
        router.refresh();
      } catch {
        setError("Hasil penyimpanan belum dapat dipastikan. Periksa daftar dan sesi, lalu muat ulang sebelum mencoba lagi.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Buat identitas otomatis?</DialogTitle>
          <DialogDescription>Untuk <strong className="text-foreground">{batch?.studentIds.length ?? 0} siswa</strong> yang belum memiliki identitas pada periode <strong className="text-foreground">{period?.name}</strong>. Identitas yang sudah ada tidak diubah.</DialogDescription>
        </DialogHeader>
        <form key={`${period?.id ?? "-"}-${open}`} onSubmit={submit} className="space-y-4 pt-2">
          {error && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertTitle>Perlu diperiksa</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          {batch && batch.totalMissing > batch.studentIds.length && <Alert className="rounded-xl"><Info className="size-4" /><AlertTitle>Batch pertama</AlertTitle><AlertDescription>{batch.studentIds.length} dari {batch.totalMissing} siswa diproses menurut urutan nama. Setelah berhasil, muat ulang dan ulangi untuk sisanya.</AlertDescription></Alert>}
          <div className="space-y-2"><label htmlFor="identity-prefix" className="text-sm font-semibold">Prefix <span className="font-normal text-muted-foreground">(opsional)</span></label><Input id="identity-prefix" name="prefix" maxLength={24} placeholder="Misalnya CBT" autoComplete="off" spellCheck={false} disabled={pending} className="h-11 rounded-xl" /><p className="text-[11px] leading-5 text-muted-foreground">Maksimal 24 karakter: huruf, angka, titik, garis bawah, atau tanda hubung.</p></div>
          <div className="space-y-2"><label htmlFor="number-pattern" className="text-sm font-semibold">Pola nomor peserta</label><Input id="number-pattern" name="numberPattern" maxLength={128} defaultValue={DEFAULT_IDENTITY_PATTERN} autoComplete="off" spellCheck={false} required disabled={pending} className="h-11 rounded-xl font-mono text-xs" /></div>
          <div className="space-y-2"><label htmlFor="username-pattern" className="text-sm font-semibold">Pola username</label><Input id="username-pattern" name="usernamePattern" maxLength={128} defaultValue={DEFAULT_IDENTITY_PATTERN} autoComplete="off" spellCheck={false} required disabled={pending} className="h-11 rounded-xl font-mono text-xs" /></div>
          <div className="rounded-xl bg-muted/40 p-3 text-[11px] leading-5 text-muted-foreground">
            <p>Gunakan <strong>{"{prefix}"}</strong>, <strong>{"{YYYYMM}"}</strong> (tanggal mulai periode), dan <strong>{"{acak3}"}</strong> (tiga angka acak). <strong>{"{acak3}"}</strong> wajib sekali; dua placeholder lain opsional, masing-masing maksimal sekali. Pemisah boleh titik, garis bawah, atau tanda hubung.</p>
            <p className="mt-2">Pola sama menghasilkan nomor dan username sama; pola berbeda dibuat terpisah. Nilai acak ditentukan saat menyimpan. Maksimal 1.000 kombinasi per pola; jika tidak cukup, tidak ada data yang disimpan.</p>
            <p className="mt-2">Batch berlaku untuk siswa yang belum memiliki identitas, bukan hasil pencarian. Siswa harus memiliki kelas aktif pada periode ini.</p>
          </div>
          <DialogFooter className="rounded-b-2xl"><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="submit" disabled={pending || !batch}>{pending ? "Membuat..." : "Ya, buat identitas"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IdentityManager({ data }: { data: IdentityPageData }) {
  const router = useRouter();
  const [changingPeriod, startChangingPeriod] = useTransition();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<ParticipantIdentityRow | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const { selected, rows, batch } = data;
  const normalized = query.trim().toLowerCase();
  const visible = rows.filter((row) => !normalized || [row.studentName, row.nisn, row.classLabel ?? "", row.participantNumber ?? "", row.username ?? ""].some((value) => value.toLowerCase().includes(normalized)));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const current = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const active = rows.filter((row) => row.placementId).length;
  const assigned = rows.filter((row) => row.placementId && row.identityId).length;
  const missing = rows.filter((row) => row.placementId && !row.identityId).length;
  const inactive = rows.filter((row) => !row.placementId && row.identityId).length;

  return (
    <div className="max-w-6xl space-y-5">
      <Alert className="rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200"><Info className="size-4 text-[#727fc8] dark:text-indigo-300" /><AlertTitle className="text-[12px] font-bold">Identitas per periode</AlertTitle><AlertDescription className="mt-0.5 text-[12px] leading-5 text-[#6873a0] dark:text-indigo-200/70">Nomor dan username unik di dalam periode masing-masing. Username yang sama boleh dipakai pada periode lain; login nantinya akan memilih periode. Sandi diatur terpisah; login peserta dan kartu belum aktif.</AlertDescription></Alert>
      {data.selectionMissing && <Alert variant="destructive" role="alert" className="rounded-2xl"><CircleAlert className="size-4" /><AlertTitle>Periode tidak ditemukan</AlertTitle><AlertDescription>Pilih periode yang masih tersedia.</AlertDescription></Alert>}
      <Card className="gap-0 rounded-[18px] p-5 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)] sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="w-full min-w-0 max-w-lg space-y-2"><label htmlFor="identity-period" className="text-sm font-semibold">Periode <span className="text-destructive">*</span></label><Select value={selected?.id ?? ""} onValueChange={(value) => startChangingPeriod(() => router.push(`/data-peserta/identitas?periode=${encodeURIComponent(value)}`))} disabled={changingPeriod || data.periods.length === 0}><SelectTrigger id="identity-period" aria-required="true" className="h-11! w-full min-w-0 rounded-xl"><SelectValue placeholder="Pilih periode" /></SelectTrigger><SelectContent position="popper">{data.periods.map((period) => <SelectItem key={period.id} value={period.id}>{period.name} · {period.startDate}</SelectItem>)}</SelectContent></Select></div>
          <Button type="button" disabled={changingPeriod || !batch} onClick={() => setGenerateOpen(true)} className="h-10 w-full rounded-xl font-semibold sm:w-auto"><Sparkles className="size-4" /> Buat otomatis</Button>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{data.periods.length ? "Pilih periode, lalu atur identitas siswa dengan kelas aktif. Pembuatan otomatis hanya mengisi yang belum ada." : <>Buat <Link href="/data-peserta/periode" className="font-semibold text-primary underline">periode</Link>, lalu atur <Link href="/data-peserta/siswa" className="font-semibold text-primary underline">penempatan siswa</Link>.</>}</p>
      </Card>
      {selected && <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[{ label: "Siswa kelas aktif", value: active }, { label: "Sudah diatur", value: assigned }, { label: "Belum diatur", value: missing }, { label: "Tanpa kelas aktif", value: inactive }].map((tile) => <div key={tile.label} className="min-w-0 rounded-2xl border border-border bg-card px-4 py-3"><p className="text-[10px] font-semibold text-muted-foreground">{tile.label}</p><p className="mt-1 text-lg font-bold tabular-nums">{tile.value}</p></div>)}
        </div>
        <Card className="min-w-0 gap-0 overflow-hidden rounded-[18px] ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border p-5 sm:px-6"><div><h2 className="text-[15px] font-bold">Daftar identitas</h2><p className="mt-1 text-[12px] leading-5 text-muted-foreground">Periode <strong>{selected.name}</strong> · mulai {selected.startDate}</p></div><div className="w-full max-w-xs space-y-2"><label htmlFor="identity-search" className="block text-[11px] font-semibold">Cari identitas</label><div className="relative"><Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" /><Input id="identity-search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Nama, NISN, kelas, nomor, username" className="h-10 rounded-xl pl-9 text-xs" /></div></div></div>
          {current.length === 0 ? <div className="flex flex-col items-center px-6 py-12 text-center"><UsersRound className="size-7 text-muted-foreground" /><h3 className="mt-4 text-sm font-bold">{rows.length ? "Identitas tidak ditemukan" : "Belum ada siswa pada periode ini"}</h3><p className="mt-1.5 text-[12px] leading-6 text-muted-foreground">{rows.length ? "Coba kata kunci lain." : <>Atur kelas siswa pada <Link href="/data-peserta/siswa" className="font-semibold text-primary underline">Data Siswa</Link> atau gunakan impor Excel.</>}</p></div> : <ul aria-label="Daftar identitas peserta" className="divide-y divide-border">{current.map((row) => <li key={row.studentId} className="flex min-w-0 flex-col gap-3 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:gap-5"><div className="flex min-w-0 flex-1 items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><IdCard className="size-[18px]" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-[13px] font-bold">{row.studentName}</h3><Badge variant={row.placementId ? "secondary" : "destructive"} className="rounded-full text-[10px]">{row.placementId ? (row.identityId ? "Sudah diatur" : "Belum diatur") : "Kelas tidak aktif"}</Badge></div><p className="mt-1 break-words text-[11px] text-muted-foreground">NISN {row.nisn} · {row.classLabel ?? "Tidak ada kelas aktif"}</p><p className="mt-1 break-words text-[11px] leading-5 text-muted-foreground">Nomor: <strong className="text-foreground">{row.participantNumber ?? "—"}</strong> · Username: <strong className="text-foreground">{row.username ?? "—"}</strong></p>{!row.placementId && <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Identitas tetap disimpan dan tidak dihapus otomatis. Tempatkan kembali siswa untuk mengubahnya.</p>}</div></div><Button type="button" variant="outline" size="sm" disabled={changingPeriod || !row.placementId} aria-label={`${row.identityId ? "Ubah" : "Atur"} identitas ${row.studentName} ${row.nisn}`} onClick={() => setEditing(row)} className="w-full rounded-lg sm:w-auto"><Pencil className="size-3.5" /> {row.identityId ? "Ubah identitas" : "Atur identitas"}</Button></li>)}</ul>}
          {visible.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6"><p className="text-[11px] text-muted-foreground">Menampilkan {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, visible.length)} dari {visible.length} siswa</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Sebelumnya</Button><Button type="button" size="sm" variant="outline" disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>Berikutnya</Button></div></div>}
        </Card>
      </>}
      <IdentityEditor row={editing} period={selected} onClose={() => setEditing(null)} />
      <GenerateDialog open={generateOpen} onClose={() => setGenerateOpen(false)} period={selected} batch={batch} />
    </div>
  );
}
