"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { AlertTriangle, ChevronLeft, ChevronRight, CircleAlert, Info, Printer, RefreshCw, ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PARTICIPANT_CARD_BATCH_SIZE } from "@/lib/participant-card-constants.mjs";
import { cardSearchParams } from "@/lib/participant-card-filter.mjs";
import type { CardPageData, PreparedCards } from "@/lib/participant-card-types";
import type { PasswordCandidate } from "@/lib/participant-password-types";

type Selection = { filters: string; candidates: PasswordCandidate[] };
type Preview = { selection: Selection; includePassword: boolean; result: PreparedCards };
type ApiReply = { ok: true; result?: PreparedCards } | { ok: false; error?: string };

const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm";
const inputClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm";
const genericError = "Kartu belum dapat disiapkan. Periksa koneksi dan sesi, lalu muat ulang daftar.";
const PREVIEW_LIFETIME_MS = 5 * 60_000;
function pageUrl(data: CardPageData, page: number) { return `/data-peserta/kartu?${cardSearchParams(data.filters, page)}`; }
function wipeVisibleSecrets() {
  // Kosongkan DOM seketika sebelum bfcache/saat halaman disembunyikan.
  document.querySelectorAll("[data-participant-card-secret]").forEach((node) => { node.textContent = ""; });
}

export function CardManager({ data }: { data: CardPageData }) {
  const { filters, selected, rows } = data;
  const [formPeriod, setFormPeriod] = useState(filters.periodId ?? "");
  const [formClass, setFormClass] = useState(filters.classId ?? "");
  const [formTest, setFormTest] = useState(filters.testId ?? "");
  const [formKind, setFormKind] = useState(filters.kind ?? "");
  const [formStudent, setFormStudent] = useState(filters.student ?? "");
  const [dirty, setDirty] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [includePassword, setIncludePassword] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewRef = useRef<Preview | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const validatedPrint = useRef(false);
  const printing = useRef(false);
  const previewDialog = useRef<HTMLDivElement>(null);
  const selectedRows = rows.filter((row) => row.candidate && chosen.has(row.studentId));
  const selectable = rows.filter((row) => row.candidate);
  const allChosen = selectable.length > 0 && selectedRows.length === selectable.length;
  const missingPassword = selectedRows.filter((row) => !row.hasPassword).length;
  const canUsePeriodFilters = Boolean(selected && formPeriod === selected.id);
  const unknownPeriod = Boolean(filters.periodId && !selected);
  const unknownClass = Boolean(filters.classId && !data.classes.some((item) => item.id === filters.classId));
  const unknownTest = Boolean(filters.testId && !data.tests.some((item) => item.id === filters.testId));

  const invalidatePreview = useCallback((message: string) => {
    generation.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    wipeVisibleSecrets();
    previewRef.current = null;
    validatedPrint.current = false;
    printing.current = false;
    setPreview(null);
    setConfirmOpen(false);
    setIncludePassword(false);
    setPending(false);
    if (message) setNotice(message);
  }, []);

  useEffect(() => {
    function hidden() {
      if (document.visibilityState === "hidden" && !printing.current && (previewRef.current || abortRef.current)) {
        invalidatePreview("Pratinjau ditutup saat halaman disembunyikan. Siapkan kembali jika diperlukan.");
      }
    }
    function pagehide() { invalidatePreview("Pratinjau ditutup saat meninggalkan halaman."); }
    function pageshow(event: PageTransitionEvent) {
      if (event.persisted) {
        setChosen(new Set()); setDirty(true);
        setNotice("Halaman dipulihkan dari riwayat. Muat ulang sebelum memilih atau mencetak lagi.");
      }
    }
    function beforeprint() {
      if (!previewRef.current) return;
      printing.current = true;
      // Ctrl+P melewati pemeriksaan ulang. Hanya tombol cetak pada pratinjau
      // yang mengizinkan kartu keluar ke media cetak.
      if (!validatedPrint.current) previewDialog.current?.setAttribute("data-print-blocked", "true");
    }
    function afterprint() {
      printing.current = false;
      previewDialog.current?.removeAttribute("data-print-blocked");
      if (previewRef.current) invalidatePreview("Dialog cetak ditutup. Pratinjau telah dihapus; siapkan lagi jika ingin mencetak ulang.");
    }
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("beforeprint", beforeprint);
    window.addEventListener("afterprint", afterprint);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("beforeprint", beforeprint);
      window.removeEventListener("afterprint", afterprint);
      generation.current += 1; abortRef.current?.abort(); wipeVisibleSecrets();
    };
  }, [invalidatePreview]);

  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(() => invalidatePreview("Pratinjau kedaluwarsa setelah lima menit. Siapkan kembali agar data diperiksa ulang."), PREVIEW_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [preview, invalidatePreview]);

  function changed() { setDirty(true); setChosen(new Set()); setIncludePassword(false); setError(""); setNotice(""); }
  function changeChoice(ids: string[]) { setChosen(new Set(ids)); setIncludePassword(false); setError(""); setNotice(""); }
  function toggleRow(studentId: string, checked: boolean) {
    const next = new Set(chosen);
    if (checked) next.add(studentId); else next.delete(studentId);
    changeChoice([...next]);
  }

  async function post(selection: Selection, mode: "prepare" | "verify", showPasswords: boolean): Promise<ApiReply | null> {
    const id = ++generation.current;
    const controller = new AbortController(); abortRef.current = controller; setPending(true); setError(""); setNotice("");
    try {
      const response = await fetch("/data-peserta/kartu/siapkan", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-NusaCBT-Cards": "1" },
        body: JSON.stringify({ mode, ...selection, includePassword: showPasswords }),
      });
      const result = await response.json() as ApiReply;
      if (generation.current !== id || document.visibilityState !== "visible") return null;
      if (!response.ok || !result.ok) {
        const message = !result.ok && typeof result.error === "string" && result.error.length <= 500 ? result.error : genericError;
        if (mode === "verify") invalidatePreview("");
        setConfirmOpen(false); setError(message);
        return null;
      }
      return result;
    } catch {
      if (generation.current === id && !controller.signal.aborted) {
        if (mode === "verify") invalidatePreview("");
        setConfirmOpen(false); setError(genericError);
      }
      return null;
    } finally {
      if (generation.current === id) { abortRef.current = null; setPending(false); }
    }
  }

  async function prepare(showPasswords: boolean) {
    if (!selected || dirty || pending || !selectedRows.length) return;
    if (showPasswords && missingPassword) { setConfirmOpen(false); setError("Ada peserta terpilih yang belum memiliki sandi. Buat sandi dahulu atau siapkan tanpa sandi."); return; }
    const selection: Selection = { filters: cardSearchParams(filters).toString(), candidates: selectedRows.map((row) => row.candidate!) };
    const reply = await post(selection, "prepare", showPasswords);
    if (!reply || !reply.ok || !reply.result) return;
    const result = reply.result;
    if (!Array.isArray(result.cards) || result.cards.length !== selection.candidates.length ||
        result.cards.some((card) => showPasswords ? typeof card.password !== "string" : card.password !== null)) {
      setConfirmOpen(false); setError(genericError); return;
    }
    const next = { selection, includePassword: showPasswords, result };
    previewRef.current = next; setConfirmOpen(false); setPreview(next);
  }

  async function printCards() {
    const current = previewRef.current;
    if (!current || pending) return;
    const reply = await post(current.selection, "verify", false);
    if (!reply || !reply.ok || previewRef.current !== current) return;
    validatedPrint.current = true;
    try { window.print(); }
    catch { invalidatePreview(""); setError("Dialog cetak tidak dapat dibuka. Periksa pengaturan browser dan siapkan kartu kembali."); }
  }

  return <div className="space-y-5">
    <Alert className="rounded-2xl"><Info className="size-4" /><AlertTitle>Peserta yang akan dicetak</AlertTitle>
      <AlertDescription className="text-xs leading-5">Gunakan periode dan kelas aktif saat ini. Tanpa filter tes dan kategori, semua siswa berkelas aktif ditampilkan, termasuk yang belum dijadwalkan. Jika tes atau kategori dipilih, siswa harus terdaftar pada <strong>pelaksanaan yang sudah dirilis</strong> dan cocok dengan keduanya pada pelaksanaan yang sama. Jadwal lampau maupun mendatang disertakan; siswa yang cocok beberapa kali hanya muncul sekali.</AlertDescription></Alert>
    {unknownPeriod && <Alert variant="destructive"><CircleAlert className="size-4" /><AlertTitle>Periode tidak ditemukan</AlertTitle><AlertDescription>Pilih periode yang tersedia dan terapkan kembali.</AlertDescription></Alert>}
    {selected && data.loginPeriodId !== selected.id && <Alert className="rounded-2xl border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle className="size-4" /><AlertTitle>Periode login peserta berbeda</AlertTitle><AlertDescription>Periode login saat halaman dimuat: <strong>{data.loginPeriodName ?? "belum diaktifkan"}</strong>. Kartu periode ini baru dapat dipakai untuk login setelah periode yang sesuai diaktifkan. Periksa <Link href="/data-peserta/periode" className="font-semibold underline">Periode Ujian</Link>; mengganti periode mengakhiri sesi peserta sebelumnya.</AlertDescription></Alert>}
    <Card className="gap-0 rounded-[20px] p-5 sm:p-6">
      <h2 className="font-bold">Filter peserta</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Pilih periode terlebih dahulu. Ubah filter lalu klik Terapkan; pilihan peserta sebelumnya akan dihapus.</p>
      <form action="/data-peserta/kartu" method="get" onChange={changed} className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div><label htmlFor="card-period" className="mb-1 block text-xs font-semibold">Periode <span aria-hidden="true" className="text-destructive">*</span></label><select id="card-period" name="periode" value={formPeriod} onChange={(event) => { setFormPeriod(event.target.value); setFormClass(""); setFormTest(""); setFormKind(""); setFormStudent(""); }} className={selectClass} required><option value="">Pilih periode</option>{unknownPeriod && <option value={filters.periodId!}>Periode tidak ditemukan</option>}{data.periods.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.startDate}</option>)}</select></div>
        <div><label htmlFor="card-class" className="mb-1 block text-xs font-semibold">Kelas aktif</label><select id="card-class" name="kelas" value={formClass} onChange={(event) => setFormClass(event.target.value)} disabled={!canUsePeriodFilters} className={selectClass}><option value="">Semua kelas</option>{unknownClass && formClass === filters.classId && <option value={filters.classId!}>Kelas tidak tersedia</option>}{data.classes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
        <div><label htmlFor="card-test" className="mb-1 block text-xs font-semibold">Tes dirilis</label><select id="card-test" name="tes" value={formTest} onChange={(event) => setFormTest(event.target.value)} disabled={!canUsePeriodFilters} className={selectClass}><option value="">Semua tes</option>{unknownTest && formTest === filters.testId && <option value={filters.testId!}>Tes dirilis tidak tersedia</option>}{data.tests.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><label htmlFor="card-kind" className="mb-1 block text-xs font-semibold">Kategori pelaksanaan</label><select id="card-kind" name="kategori" value={formKind} onChange={(event) => setFormKind(event.target.value)} disabled={!canUsePeriodFilters} className={selectClass}><option value="">Semua kategori</option><option value="regular">Reguler</option><option value="makeup">Susulan</option><option value="remedial">Remidi</option></select></div>
        <div><label htmlFor="card-student" className="mb-1 block text-xs font-semibold">Siswa / NISN / username</label><input id="card-student" name="siswa" value={formStudent} onChange={(event) => setFormStudent(event.target.value)} maxLength={100} disabled={!canUsePeriodFilters} className={inputClass} placeholder="Cari peserta" /></div>
        <div className="flex flex-wrap gap-2 lg:col-span-5"><Button type="submit" className="rounded-lg">Terapkan</Button><Button asChild variant="outline" className="rounded-lg"><Link href="/data-peserta/kartu" prefetch={false}>Reset filter</Link></Button>{dirty && <span role="status" className="self-center text-xs text-amber-700 dark:text-amber-300">Filter berubah; terapkan sebelum memilih peserta.</span>}</div>
      </form>
      {!canUsePeriodFilters && <p className="mt-3 text-xs text-muted-foreground">Terapkan periode untuk memuat pilihan kelas dan tesnya.</p>}
    </Card>
    {notice && <Alert role="status" className="rounded-2xl"><Info className="size-4" /><AlertDescription>{notice}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert" className="rounded-2xl"><CircleAlert className="size-4" /><AlertTitle>Kartu tidak disiapkan</AlertTitle><AlertDescription>{error} <button type="button" className="font-semibold underline" onClick={() => window.location.reload()}>Muat ulang daftar</button>.</AlertDescription></Alert>}
    <noscript><p className="rounded-xl border p-4 text-sm">JavaScript diperlukan untuk memilih peserta, menyiapkan pratinjau, dan mencetak kartu.</p></noscript>
    {selected && <>
      <Card className="gap-0 overflow-hidden rounded-[20px] py-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5"><div><h2 className="font-bold">Daftar peserta <Badge variant="secondary">{data.total}</Badge></h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Periode {selected.name}. Hanya siswa dengan identitas dan username dapat dipilih; sandi tidak diperlukan untuk mencetak tanpa sandi.</p></div>
          <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()} disabled={pending}><RefreshCw className="size-4" /> Muat ulang</Button></div>
        {(unknownClass || unknownTest) && <p role="status" className="border-b px-5 py-3 text-xs text-amber-700 dark:text-amber-300">Filter kelas atau tes tidak lagi tersedia pada periode ini. Hasil tidak diperluas otomatis; periksa dan terapkan filter lain.</p>}
        {rows.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">Tidak ada peserta yang cocok. Periksa periode, kelas, identitas, atau pelaksanaan yang sudah dirilis.</div> : <>
          <label className="flex items-center gap-3 border-b bg-muted/30 px-5 py-3 text-sm font-semibold"><input type="checkbox" className="size-4 accent-primary" checked={allChosen} disabled={dirty || pending || !selectable.length} onChange={(event) => changeChoice(event.target.checked ? selectable.map((row) => row.studentId) : [])} /> Pilih semua yang beridentitas pada halaman ini</label>
          <ul aria-label="Daftar peserta untuk kartu" className="divide-y divide-border">{rows.map((row) => <li key={row.studentId} className="flex min-w-0 items-start gap-3 px-5 py-4">
            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" aria-label={`Pilih ${row.studentName} NISN ${row.nisn}`} checked={chosen.has(row.studentId)} disabled={!row.candidate || dirty || pending} onChange={(event) => toggleRow(row.studentId, event.target.checked)} />
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="break-words text-sm">{row.studentName}</strong><Badge variant={row.candidate ? "secondary" : "destructive"}>{row.candidate ? (row.hasPassword ? "Sandi tersedia" : "Belum bersandi") : "Belum beridentitas"}</Badge></div>
              <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">NISN {row.nisn} · {row.classLabel} · Nomor {row.participantNumber ?? "—"} · Username {row.username ?? "—"}</p></div>
          </li>)}</ul>
        </>}
        {data.total > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4"><p className="text-xs text-muted-foreground">Menampilkan {(data.page - 1) * PARTICIPANT_CARD_BATCH_SIZE + 1}–{Math.min(data.page * PARTICIPANT_CARD_BATCH_SIZE, data.total)} dari {data.total}. Pilihan tidak dibawa ke halaman lain.</p>
          <div className="flex gap-2">{data.page > 1 ? <Button asChild variant="outline" size="sm"><Link href={pageUrl(data, data.page - 1)} prefetch={false}><ChevronLeft className="size-4" /> Sebelumnya</Link></Button> : <Button disabled variant="outline" size="sm"><ChevronLeft className="size-4" /> Sebelumnya</Button>}
            {data.page < data.pages ? <Button asChild variant="outline" size="sm"><Link href={pageUrl(data, data.page + 1)} prefetch={false}>Berikutnya <ChevronRight className="size-4" /></Link></Button> : <Button disabled variant="outline" size="sm">Berikutnya <ChevronRight className="size-4" /></Button>}</div></div>}
      </Card>
      <Card className="gap-0 rounded-[20px] p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-bold">Siapkan kartu</h2><p className="mt-1 text-xs leading-5 text-muted-foreground"><strong>{selectedRows.length}</strong> peserta dipilih pada halaman ini. Maksimal {PARTICIPANT_CARD_BATCH_SIZE} kartu per batch; untuk lebih banyak, cetak halaman berikutnya.</p></div><Button type="button" disabled={dirty || pending || !selectedRows.length || (includePassword && missingPassword > 0)} onClick={() => includePassword ? setConfirmOpen(true) : void prepare(false)} className="rounded-xl"><Printer className="size-4" /> {pending ? "Menyiapkan..." : "Pratinjau kartu"}</Button></div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/25"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={includePassword} disabled={dirty || pending || !selectedRows.length} onChange={(event) => setIncludePassword(event.target.checked)} /><span><strong>Sertakan sandi pada kartu</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">Opsional dan awalnya tidak dicentang. Sandi hanya diminta setelah konfirmasi; setiap sandi yang berhasil disiapkan dicatat. Kartu dan PDF yang memuatnya harus dijaga rahasia.</span></span></label>
        {missingPassword > 0 && <p role="status" className="mt-3 text-xs leading-5 text-amber-700 dark:text-amber-300">{missingPassword} peserta terpilih belum bersandi. Anda dapat mencetak tanpa sandi atau membuatnya di <Link href="/data-peserta/akun" className="font-semibold underline">Akun Peserta</Link>, lalu muat ulang.</p>}
        <p className="mt-3 text-xs leading-5 text-muted-foreground">Data diperiksa kembali sebelum dialog cetak. Gunakan tombol cetak pada pratinjau, bukan Ctrl+P. Perubahan setelah pemeriksaan tetap dapat membuat hasil usang.</p>
      </Card>
    </>}
    <Dialog open={confirmOpen} onOpenChange={(open) => { if (!pending) setConfirmOpen(open); }}>
      <DialogContent className="rounded-2xl sm:max-w-lg" showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>Tampilkan sandi pada kartu?</DialogTitle><DialogDescription>Anda akan menyiapkan sandi untuk <strong className="text-foreground">{selectedRows.length} peserta</strong> pada periode <strong className="text-foreground">{selected?.name}</strong>.</DialogDescription></DialogHeader>
        <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><ShieldAlert className="size-4" /><AlertTitle>Informasi rahasia</AlertTitle><AlertDescription>Setiap pengungkapan berhasil disiapkan dicatat, termasuk bila dialog cetak dibatalkan. Pastikan layar, printer, antrean cetak, dan PDF hanya diakses pihak berwenang.</AlertDescription></Alert>
        <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmOpen(false)}>Batal</Button><Button type="button" disabled={pending || missingPassword > 0} onClick={() => void prepare(true)}>{pending ? "Menyiapkan..." : "Ya, tampilkan sandi"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {preview && <DialogPrimitive.Root open onOpenChange={(open) => { if (!open && !pending) invalidatePreview("Pratinjau ditutup dan dihapus dari halaman."); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="participant-card-preview-overlay" />
        <DialogPrimitive.Content ref={previewDialog} className="participant-card-preview-dialog" onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
          <div className="participant-card-preview-toolbar"><div><DialogPrimitive.Title>Pratinjau {preview.result.cards.length} kartu peserta</DialogPrimitive.Title><DialogPrimitive.Description>Disiapkan {preview.result.preparedAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}. {preview.includePassword ? "Sandi terlihat dan bersifat rahasia. " : "Sandi tidak disertakan. "}Pilih A4; gunakan Simpan sebagai PDF bila diperlukan. Pratinjau ditutup setelah dialog cetak atau lima menit.</DialogPrimitive.Description></div>
            <div className="participant-card-preview-actions"><Button type="button" variant="outline" disabled={pending} onClick={() => invalidatePreview("Pratinjau ditutup dan dihapus dari halaman.")}>Tutup</Button><Button type="button" disabled={pending} onClick={() => void printCards()}><Printer className="size-4" /> {pending ? "Memeriksa..." : "Cetak / Simpan PDF"}</Button></div></div>
          <div className="participant-card-sheet-scroll"><p className="participant-card-print-blocked">Gunakan tombol Cetak / Simpan PDF pada pratinjau agar data peserta diperiksa kembali sebelum dicetak.</p><div className="participant-card-print-grid">{preview.result.cards.map((card, index) => <article className="participant-card-paper" data-testid="participant-card" key={`${card.nisn}-${index}`}>
            <header className="participant-card-paper-head"><div className="participant-card-paper-brand">NusaCBT<small>PLATFORM UJIAN SEKOLAH</small></div><div className="participant-card-paper-label">Kartu<br />peserta</div></header>
            <h3 dir="auto" className="participant-card-paper-name">{card.studentName}</h3>
            <dl className="participant-card-paper-data"><dt>Periode</dt><dd dir="auto">{preview.result.periodName}</dd><dt>NISN</dt><dd>{card.nisn}</dd><dt>Kelas</dt><dd dir="auto">{card.classLabel}</dd><dt>No. peserta</dt><dd>{card.participantNumber}</dd></dl>
            <div className="participant-card-paper-login"><div><span>USERNAME</span><strong dir="ltr">{card.username}</strong></div><div><span>SANDI</span>{preview.includePassword ? <strong dir="auto" data-participant-card-secret>{card.password}</strong> : <strong>Tidak disertakan</strong>}</div></div>
            <p className="participant-card-paper-footer">Gunakan alamat login yang diberikan sekolah. Jaga kerahasiaan akun ini.</p>
          </article>)}</div></div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>}
  </div>;
}
