"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarRange, Info, LogIn, LogOut, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deletePeriod, savePeriod, setActiveLoginPeriod } from "@/app/data-peserta/periode/actions";
import { useCanDevCascadeDelete } from "@/components/admin-user-context";
import { DevCascadeDeleteDialog } from "@/components/dev-cascade-delete-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ExamPeriod } from "@/lib/period-types";

const dateFormatter = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

function PeriodEditor({
  period,
  open,
  onOpenChange,
  years,
}: {
  period: ExamPeriod | null;
  years: Array<{ id: string; name: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) setError("");
    onOpenChange(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (period) { formData.set("id", period.id); formData.set("expectedRevision", period.revision); }
    setError("");
    startTransition(async () => {
      try {
        const result = await savePeriod(formData);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onOpenChange(false);
        toast.success(result.message);
        router.refresh();
      } catch {
        setError("Hasil penyimpanan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar sebelum mencoba lagi.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md" showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{period ? "Ubah periode" : "Tambah periode"}</DialogTitle>
          <DialogDescription>Isi nama dan tanggal mulai. Tanggal akhir boleh dikosongkan.</DialogDescription>
        </DialogHeader>
        <form key={period?.id ?? "baru"} onSubmit={handleSubmit} className="space-y-4 pt-2">
          {error && <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-2">
            <label htmlFor="period-year" className="text-sm font-semibold">Tahun ajaran <span className="text-destructive">*</span></label>
            {period?.yearId ? <><input type="hidden" name="yearId" value={period.yearId} /><p id="period-year" className="rounded-xl border p-3 text-sm">{period.yearName}</p></> : <select id="period-year" name="yearId" required disabled={pending} defaultValue="" className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="">Pilih tahun ajaran</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select>}
            {period && !period.yearId && <p className="text-xs text-amber-700 dark:text-amber-300">Periode lama belum dipetakan. Siswa aktif periode akan ditambahkan ke tahun ini; konflik kelas/status harus diperiksa dahulu.</p>}
          </div>
          <div className="space-y-2">
            <label htmlFor="period-name" className="text-sm font-semibold">Nama periode <span className="text-destructive">*</span></label>
            <Input id="period-name" name="name" maxLength={100} defaultValue={period?.name ?? ""} placeholder="Contoh: Ujian Semester Ganjil" required disabled={pending} className="h-11 rounded-xl" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="period-start" className="text-sm font-semibold">Tanggal mulai <span className="text-destructive">*</span></label>
              <Input id="period-start" name="startDate" type="date" defaultValue={period?.startDate ?? ""} required disabled={pending} className="h-11 rounded-xl" />
            </div>
            <div className="space-y-2">
              <label htmlFor="period-end" className="text-sm font-semibold">Tanggal akhir</label>
              <Input id="period-end" name="endDate" type="date" defaultValue={period?.endDate ?? ""} disabled={pending} className="h-11 rounded-xl" />
            </div>
          </div>
          <DialogFooter className="mt-5 -mx-4 -mb-4 rounded-b-2xl">
            <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>Batal</Button>
            <Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan periode"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeletePeriodDialog({
  period,
  onClose,
  onRequestCascade,
}: {
  period: ExamPeriod | null;
  onClose: () => void;
  onRequestCascade: (period: ExamPeriod) => void;
}) {
  const router = useRouter();
  const canDevCascade = useCanDevCascadeDelete();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setError("");
    onClose();
  }

  function handleDelete() {
    if (!period) return;
    const formData = new FormData();
    formData.set("id", period.id);
    setError("");
    startTransition(async () => {
      try {
        const result = await deletePeriod(formData);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onClose();
        toast.success(result.message);
        router.refresh();
      } catch {
        setError("Hasil penghapusan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar sebelum mencoba lagi.");
      }
    });
  }

  return (
    <Dialog open={period !== null} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md" showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Hapus periode?</DialogTitle>
          <DialogDescription>Periode <strong className="text-foreground">{period?.name}</strong> akan dihapus permanen. Kelompok sesi yang kosong ikut dihapus. Periode yang sedang aktif atau memiliki data terkait tidak dapat dihapus melalui penghapusan standar.</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter className="flex-wrap gap-2 rounded-b-2xl">
          <Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button>
          {canDevCascade && period && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                const target = period;
                close();
                onRequestCascade(target);
              }}
              className="border-amber-400 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"
            >
              Hapus beserta dependensi (Mode Dev)
            </Button>
          )}
          <Button type="button" variant="destructive" disabled={pending} onClick={handleDelete}>{pending ? "Menghapus..." : "Ya, hapus periode"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type LoginChoice =
  | { mode: "activate"; target: ExamPeriod }
  | { mode: "deactivate"; target: ExamPeriod }
  | { mode: "clear_all"; target: null };

function LoginPeriodDialog({ choice, activeRevision, onClose }: { choice: LoginChoice; activeRevision: string; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function close() { if (!pending) onClose(); }
  function confirm() {
    const form = new FormData();
    form.set("mode", choice.mode);
    form.set("periodId", choice.target?.id ?? "");
    form.set("expectedRevision", activeRevision);
    form.set("targetRevision", choice.target?.revision ?? "");
    setError("");
    startTransition(async () => {
      try {
        const result = await setActiveLoginPeriod(form);
        if (!result.ok) { setError(result.error); return; }
        onClose();
        toast.success(result.message);
        router.refresh();
      } catch {
        setError("Hasil pengaturan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang halaman.");
      }
    });
  }
  const title =
    choice.mode === "activate" ? "Aktifkan periode login?"
      : choice.mode === "deactivate" ? "Nonaktifkan periode login?"
        : "Nonaktifkan semua login peserta?";
  const description =
    choice.mode === "activate"
      ? <>Peserta pada periode <strong className="text-foreground">{choice.target.name}</strong> dapat masuk. Periode lain yang sedang aktif tetap aktif.</>
      : choice.mode === "deactivate"
        ? <>Peserta pada periode <strong className="text-foreground">{choice.target.name}</strong> tidak dapat masuk dan seluruh sesinya diakhiri. Periode lain yang aktif tidak terpengaruh.</>
        : "Semua periode login akan dinonaktifkan dan peserta tidak dapat masuk sampai ada periode yang diaktifkan lagi.";

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md" showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <Alert role="note">
        <Info className="size-4" />
        <AlertTitle>{choice.mode === "activate" ? "Dukungan multi-periode aktif" : "Sesi peserta terkait akan diakhiri"}</AlertTitle>
        <AlertDescription>
          {choice.mode === "activate"
            ? "Jika hanya 1 periode yang aktif, peserta masuk langsung tanpa memilih periode. Jika 2 atau lebih periode aktif bersamaan, halaman login peserta menampilkan pilihan periode aktif."
            : "Identitas dan sandi peserta tetap tersimpan dan tidak diubah."}
        </AlertDescription>
      </Alert>
      {error && <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button>
        <Button type="button" variant={choice.mode === "activate" ? "default" : "destructive"} disabled={pending} onClick={confirm}>
          {pending ? "Menyimpan..." : choice.mode === "activate" ? "Ya, aktifkan login" : choice.mode === "deactivate" ? "Ya, nonaktifkan periode" : "Ya, nonaktifkan semua"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function PeriodManager({ periods, years, activeYearId, activeRevision }: { periods: ExamPeriod[]; years: Array<{ id: string; name: string }>; activeYearId: string | null; activeRevision: string }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ExamPeriod | null>(null);
  const [deleting, setDeleting] = useState<ExamPeriod | null>(null);
  const [cascadeTarget, setCascadeTarget] = useState<ExamPeriod | null>(null);
  const [loginChoice, setLoginChoice] = useState<LoginChoice | null>(null);
  const activePeriods = periods.filter((period) => period.isActive);

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(period: ExamPeriod) {
    setEditing(period);
    setEditorOpen(true);
  }

  return (
    <>
      <Alert className="mb-6 max-w-4xl rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200">
        <Info className="size-4 text-[#727fc8] dark:text-indigo-300" />
        <AlertTitle className="text-[12px] font-bold">Identitas peserta per periode &amp; multi-periode aktif</AlertTitle>
        <AlertDescription className="mt-0.5 text-[12px] leading-5 text-[#6873a0] dark:text-indigo-200/70">
          Siswa dikelola per tahun ajaran, sedangkan identitas dan sandi per periode. Anda dapat mengaktifkan satu atau beberapa periode pada tahun aktif secara bersamaan.
        </AlertDescription>
      </Alert>

      <Card className="mb-6 flex flex-col gap-4 rounded-[18px] p-5 ring-1 ring-border sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold">Periode login peserta</h2>
          {activePeriods.length > 0 ? (
            <div className="mt-1.5 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {activePeriods.map((period) => (
                  <Badge key={period.id} variant="default" className="rounded-full text-[11px]">{period.name}</Badge>
                ))}
              </div>
              <p className="text-[12px] leading-5 text-muted-foreground">
                {activePeriods.length === 1
                  ? "1 periode aktif — peserta masuk otomatis tanpa memilih periode."
                  : `${activePeriods.length} periode aktif bersamaan — halaman login peserta menampilkan pilihan periode aktif.`}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-[12px] leading-6 text-muted-foreground">
              Belum ada periode login aktif. Peserta belum dapat masuk; aktifkan satu atau lebih periode di bawah.
            </p>
          )}
        </div>
        {activePeriods.length > 0 && (
          <Button type="button" variant="outline" onClick={() => setLoginChoice({ mode: "clear_all", target: null })} className="shrink-0 rounded-xl">
            Nonaktifkan semua login
          </Button>
        )}
      </Card>

      <Card className="gap-0 overflow-hidden rounded-[18px] bg-card py-0 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5 sm:px-6">
          <div>
            <div className="flex items-center gap-2.5"><h2 className="text-[15px] font-bold">Daftar periode</h2><Badge variant="secondary" className="rounded-full text-[10px]">{periods.length} periode</Badge></div>
            <p className="mt-1 text-[12px] text-muted-foreground">Tambah periode pada tahun ajaran yang sudah dibuat. Periode lama perlu dipetakan secara eksplisit.</p>
          </div>
          <Button onClick={openCreate} className="h-10 rounded-xl px-4 font-semibold"><Plus className="size-4" /> Tambah periode</Button>
        </div>

        {periods.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><CalendarRange className="size-6" /></span>
            <h3 className="mt-4 text-sm font-bold">Belum ada periode</h3>
            <p className="mt-1.5 max-w-sm text-[12px] leading-6 text-muted-foreground">Buat periode pertama untuk menyiapkan pengelolaan peserta ujian.</p>
          </div>
        ) : (
          <ul aria-label="Daftar periode ujian" className="divide-y divide-border">
            {periods.map((period) => (
              <li key={period.id} className="flex flex-col gap-4 p-5 sm:px-6 lg:flex-row lg:items-center lg:gap-6">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><CalendarDays className="size-[18px]" /></span>
                  <div className="min-w-0">
                    <h3 className="break-words text-[13px] font-bold">{period.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {period.isActive && <Badge variant="default" className="rounded-full text-[10px]">Login aktif</Badge>}
                      <p className="text-[11px] text-muted-foreground">{period.yearName ?? "Belum dipetakan ke tahun ajaran"}</p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 text-[12px] sm:max-w-md lg:w-80 lg:shrink-0">
                  <div><p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Mulai</p><p className="mt-1 font-medium">{formatDate(period.startDate)}</p></div>
                  <div><p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Akhir</p><p className="mt-1 font-medium">{period.endDate ? formatDate(period.endDate) : "Tidak ditentukan"}</p></div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                  {period.isActive ? (
                    <Button variant="outline" size="sm" aria-label={`Nonaktifkan login ${period.name}`} onClick={() => setLoginChoice({ mode: "deactivate", target: period })} className="rounded-lg">
                      <LogOut className="size-3.5" /> Nonaktifkan login
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled={!period.yearId || period.yearId !== activeYearId} title={period.yearId !== activeYearId ? "Aktifkan tahun ajaran terkait terlebih dahulu" : undefined} aria-label={`Aktifkan login ${period.name}`} onClick={() => setLoginChoice({ mode: "activate", target: period })} className="rounded-lg">
                      <LogIn className="size-3.5" /> Aktifkan login
                    </Button>
                  )}
                  <Button variant="outline" size="sm" aria-label={`Ubah periode ${period.name}`} onClick={() => openEdit(period)} className="rounded-lg"><Pencil className="size-3.5" /> Ubah</Button>
                  <Button variant="outline" size="sm" aria-label={`Hapus periode ${period.name}`} onClick={() => setDeleting(period)} className="rounded-lg text-destructive hover:text-destructive"><Trash2 className="size-3.5" /> Hapus</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <PeriodEditor period={editing} years={years} open={editorOpen} onOpenChange={setEditorOpen} />
      <DeletePeriodDialog period={deleting} onClose={() => setDeleting(null)} onRequestCascade={(item) => setCascadeTarget(item)} />
      {loginChoice && <LoginPeriodDialog choice={loginChoice} activeRevision={activeRevision} onClose={() => setLoginChoice(null)} />}
      <DevCascadeDeleteDialog
        open={cascadeTarget !== null}
        onOpenChange={(open) => { if (!open) setCascadeTarget(null); }}
        entityType="period"
        entityId={cascadeTarget?.id ?? null}
        entityTitle={cascadeTarget?.name ?? ""}
      />
    </>
  );
}
