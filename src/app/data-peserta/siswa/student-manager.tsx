"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, History, Info, Pencil, Plus, Search, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { deleteStudent, endPlacement, savePlacement, saveStudent } from "@/app/data-peserta/siswa/actions";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PlacementClass, PlacementPeriod, Student, StudentPlacement } from "@/lib/student-types";

const dialogClass = "max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md";

function StudentEditor({ student, open, onOpenChange }: { student: Student | null; open: boolean; onOpenChange: (open: boolean) => void }) {
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
    if (student) {
      formData.set("id", student.id);
      formData.set("version", student.version);
    }
    setError("");
    startTransition(async () => {
      try {
        const result = await saveStudent(formData);
        if (!result.ok) return setError(result.error);
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
      <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{student ? "Ubah siswa" : "Tambah siswa"}</DialogTitle>
          <DialogDescription>{student ? "Nama dan NISN berlaku untuk siswa di semua periode; perubahan identitas tidak mengubah riwayat kelas." : "Isi nama dan NISN siswa. Kelas diatur terpisah untuk setiap periode."}</DialogDescription>
        </DialogHeader>
        <form key={`${student?.id ?? "baru"}-${open}`} onSubmit={handleSubmit} className="space-y-4 pt-2">
          {error && <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-2">
            <label htmlFor="student-name" className="text-sm font-semibold">Nama siswa <span className="text-destructive">*</span></label>
            <Input id="student-name" name="name" maxLength={200} defaultValue={student?.name ?? ""} placeholder="Nama lengkap siswa" required disabled={pending} className="h-11 rounded-xl" />
          </div>
          <div className="space-y-2">
            <label htmlFor="student-nisn" className="text-sm font-semibold">NISN <span className="text-destructive">*</span></label>
            <Input id="student-nisn" name="nisn" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={64} defaultValue={student?.nisn ?? ""} placeholder="10 digit NISN" required disabled={pending} className="h-11 rounded-xl" />
            <p className="text-[11px] leading-5 text-muted-foreground">Wajib tepat 10 digit dan unik. Nol di depan tetap disimpan.</p>
          </div>
          <DialogFooter className="mt-5 -mx-4 -mb-4 rounded-b-2xl">
            <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>Batal</Button>
            <Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan siswa"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteStudentDialog({ student, onClose }: { student: Student | null; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setError("");
    onClose();
  }

  function handleDelete() {
    if (!student) return;
    const formData = new FormData();
    formData.set("id", student.id);
    formData.set("version", student.version);
    setError("");
    startTransition(async () => {
      try {
        const result = await deleteStudent(formData);
        if (!result.ok) return setError(result.error);
        onClose();
        toast.success(result.message);
        router.refresh();
      } catch {
        setError("Hasil penghapusan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar sebelum mencoba lagi.");
      }
    });
  }

  return (
    <Dialog open={student !== null} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Hapus siswa?</DialogTitle>
          <DialogDescription><strong className="text-foreground">{student?.name}</strong> ({student?.nisn}) akan dihapus permanen. Siswa yang memiliki riwayat penempatan tidak dapat dihapus.</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter className="rounded-b-2xl">
          <Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={handleDelete}>{pending ? "Menghapus..." : "Ya, hapus siswa"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type EndTarget = { student: Student; placement: StudentPlacement };

function EndPlacementDialog({ target, onClose }: { target: EndTarget | null; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setError("");
    onClose();
  }

  function handleEnd() {
    if (!target) return;
    const formData = new FormData();
    formData.set("studentId", target.student.id);
    formData.set("placementId", target.placement.id);
    setError("");
    startTransition(async () => {
      try {
        const result = await endPlacement(formData);
        if (!result.ok) return setError(result.error);
        onClose();
        toast.success(result.message);
        router.refresh();
      } catch {
        setError("Hasil perubahan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar sebelum mencoba lagi.");
      }
    });
  }

  return (
    <Dialog open={target !== null} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Akhiri penempatan?</DialogTitle>
          <DialogDescription>Penempatan <strong className="text-foreground">{target?.student.name}</strong> pada kelas <strong className="text-foreground">{target?.placement.classNameSnapshot}</strong> untuk periode <strong className="text-foreground">{target?.placement.periodName}</strong> akan diakhiri. Riwayatnya tetap disimpan.</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter className="rounded-b-2xl">
          <Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={handleEnd}>{pending ? "Menyimpan..." : "Ya, akhiri penempatan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlacementDialog({
  student,
  periods,
  classes,
  placements,
  onClose,
  onEnd,
}: {
  student: Student | null;
  periods: PlacementPeriod[];
  classes: PlacementClass[];
  placements: StudentPlacement[];
  onClose: () => void;
  onEnd: (target: EndTarget) => void;
}) {
  const router = useRouter();
  const [periodId, setPeriodId] = useState("");
  const [classId, setClassId] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const history = student ? placements.filter((item) => item.studentId === student.id) : [];
  const active = history.find((item) => item.periodId === periodId && item.endedLabel === null);

  function close() {
    if (pending) return;
    setError("");
    setPeriodId("");
    setClassId("");
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!student) return;
    if (!periodId) return setError("Pilih periode terlebih dahulu.");
    if (!classId) return setError("Pilih kelas terlebih dahulu.");
    const formData = new FormData();
    formData.set("studentId", student.id);
    formData.set("periodId", periodId);
    formData.set("classId", classId);
    formData.set("expectedPlacementId", active?.id ?? "");
    setError("");
    startTransition(async () => {
      try {
        const result = await savePlacement(formData);
        if (!result.ok) return setError(result.error);
        setPeriodId("");
        setClassId("");
        onClose();
        toast.success(result.message);
        router.refresh();
      } catch {
        setError("Hasil penyimpanan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar sebelum mencoba lagi.");
      }
    });
  }

  return (
    <Dialog open={student !== null} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-xl" showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Kelola penempatan</DialogTitle>
          <DialogDescription><strong className="text-foreground">{student?.name}</strong> · NISN {student?.nisn}. Satu kelas aktif untuk setiap periode; perubahan tetap menyimpan riwayat.</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        {(periods.length === 0 || classes.length === 0) && (
          <Alert className="rounded-xl">
            <Info className="size-4" />
            <AlertTitle>Siapkan periode dan kelas</AlertTitle>
            <AlertDescription>Penempatan memerlukan <Link className="font-semibold text-primary underline" href="/data-peserta/periode">periode</Link> dan <Link className="font-semibold text-primary underline" href="/data-peserta/kelas">kelas</Link> yang sudah dibuat.</AlertDescription>
          </Alert>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <label htmlFor="placement-period" className="text-sm font-semibold">Periode <span className="text-destructive">*</span></label>
              <Select value={periodId} onValueChange={(value) => { setPeriodId(value); setClassId(""); setError(""); }} disabled={pending || periods.length === 0}>
                <SelectTrigger id="placement-period" aria-required="true" className="h-11! w-full min-w-0 rounded-xl"><SelectValue placeholder="Pilih periode" /></SelectTrigger>
                <SelectContent position="popper">
                  {periods.map((period) => <SelectItem key={period.id} value={period.id}>{period.name} · {period.startDate}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-2">
              <label htmlFor="placement-class" className="text-sm font-semibold">Kelas <span className="text-destructive">*</span></label>
              <Select value={classId} onValueChange={(value) => { setClassId(value); setError(""); }} disabled={pending || classes.length === 0}>
                <SelectTrigger id="placement-class" aria-required="true" className="h-11! w-full min-w-0 rounded-xl"><SelectValue placeholder="Pilih kelas" /></SelectTrigger>
                <SelectContent position="popper">
                  {classes.map((schoolClass) => <SelectItem key={schoolClass.id} value={schoolClass.id}>{schoolClass.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {active && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              Kelas aktif periode ini: <strong>{active.classNameSnapshot}</strong>. Memilih kelas lain akan mengakhiri penempatan lama tanpa menghapus riwayatnya.
            </p>
          )}
          <Button type="submit" disabled={pending || periods.length === 0 || classes.length === 0} className="w-full rounded-xl sm:w-auto">{pending ? "Menyimpan..." : "Simpan penempatan"}</Button>
        </form>
        <div className="border-t border-border pt-4">
          <div className="flex items-center gap-2"><History className="size-4 text-muted-foreground" /><h3 className="text-sm font-bold">Riwayat penempatan</h3></div>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Nama kelas disalin saat ditempatkan. Waktu pencatatan ditampilkan dalam UTC.</p>
          {history.length === 0 ? (
            <p className="mt-3 rounded-xl bg-muted/40 p-3 text-[12px] text-muted-foreground">Belum ada penempatan untuk siswa ini.</p>
          ) : (
            <ul aria-label="Riwayat penempatan" className="mt-3 space-y-2">
              {history.map((item) => (
                <li key={item.id} className="min-w-0 rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><p className="break-words text-[13px] font-bold">{item.classNameSnapshot}</p><p className="mt-1 break-words text-[11px] text-muted-foreground">{item.periodName} · mulai {item.periodStart}</p></div>
                    <Badge variant={item.endedLabel === null ? "default" : "secondary"} className="rounded-full text-[10px]">{item.endedLabel === null ? "Aktif di periode" : "Berakhir"}</Badge>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">Dicatat {item.startedLabel}{item.endedLabel && ` · Diakhiri ${item.endedLabel}`}</p>
                  {item.endedLabel === null && student && <Button type="button" variant="outline" size="sm" disabled={pending} aria-label={`Akhiri penempatan ${item.periodName} ${item.classNameSnapshot}`} className="mt-2 rounded-lg text-destructive hover:text-destructive" onClick={() => { const target = { student, placement: item }; close(); onEnd(target); }}>Akhiri penempatan</Button>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter className="rounded-b-2xl"><Button type="button" variant="outline" disabled={pending} onClick={close}>Tutup</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StudentManager({ students, periods, classes, placements }: { students: Student[]; periods: PlacementPeriod[]; classes: PlacementClass[]; placements: StudentPlacement[] }) {
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [placementStudent, setPlacementStudent] = useState<Student | null>(null);
  const [ending, setEnding] = useState<EndTarget | null>(null);
  const normalized = query.trim().toLowerCase();
  const visible = students.filter((student) => !normalized || student.name.toLowerCase().includes(normalized) || student.nisn.includes(normalized));
  const activeByStudent = new Map<string, number>();
  for (const placement of placements) {
    if (placement.endedLabel === null) activeByStudent.set(placement.studentId, (activeByStudent.get(placement.studentId) ?? 0) + 1);
  }

  function openEditor(student: Student | null) {
    setEditing(student);
    setEditorOpen(true);
  }

  return (
    <>
      <Alert className="mb-6 max-w-4xl rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200">
        <Info className="size-4 text-[#727fc8] dark:text-indigo-300" />
        <AlertTitle className="text-[12px] font-bold">Data siswa dan riwayat kelas</AlertTitle>
        <AlertDescription className="mt-0.5 text-[12px] leading-5 text-[#6873a0] dark:text-indigo-200/70">NISN unik disimpan sebagai teks. Penempatan dikelola per periode dan nama kelas saat ditempatkan tetap tercatat. <Link href="/data-peserta/import" className="font-semibold underline">Impor Excel</Link> dan <Link href="/data-peserta/akun" className="font-semibold underline">akun peserta</Link> tersedia untuk identitas dan sandi. Login peserta memakai periode yang diaktifkan admin; kartu belum tersedia.</AlertDescription>
      </Alert>
      <Card className="gap-0 overflow-hidden rounded-[18px] bg-card py-0 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5 sm:px-6">
          <div><div className="flex items-center gap-2.5"><h2 className="text-[15px] font-bold">Daftar siswa</h2><Badge variant="secondary" className="rounded-full text-[10px]">{students.length} siswa</Badge></div><p className="mt-1 text-[12px] text-muted-foreground">Tambah siswa secara manual, lalu atur penempatannya.</p></div>
          <Button onClick={() => openEditor(null)} className="h-10 rounded-xl px-4 font-semibold"><Plus className="size-4" /> Tambah siswa</Button>
        </div>
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <label htmlFor="student-search" className="mb-2 block text-[12px] font-semibold">Cari siswa</label>
          <div className="relative max-w-md"><Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" /><Input id="student-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama atau NISN" className="h-11 rounded-xl pl-9" /></div>
        </div>
        {visible.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center"><UsersRound className="size-7 text-muted-foreground" /><h3 className="mt-4 text-sm font-bold">{students.length === 0 ? "Belum ada siswa" : "Siswa tidak ditemukan"}</h3><p className="mt-1.5 text-[12px] leading-6 text-muted-foreground">{students.length === 0 ? "Tambahkan siswa pertama dengan nama dan NISN." : "Coba kata kunci nama atau NISN lain."}</p></div>
        ) : (
          <ul aria-label="Daftar siswa" className="divide-y divide-border">
            {visible.map((student) => {
              const activeCount = activeByStudent.get(student.id) ?? 0;
              return (
                <li key={student.id} className="flex min-w-0 flex-col gap-3 p-5 sm:px-6 lg:flex-row lg:items-center lg:gap-5">
                  <div className="flex min-w-0 flex-1 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><UsersRound className="size-[18px]" /></span><div className="min-w-0"><h3 className="break-words text-[13px] font-bold">{student.name}</h3><p className="mt-1 text-[11px] text-muted-foreground">NISN {student.nisn} · {activeCount} periode memiliki kelas aktif</p></div></div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Button variant="outline" size="sm" aria-label={`Kelola penempatan ${student.name} ${student.nisn}`} onClick={() => setPlacementStudent(student)} className="rounded-lg"><CalendarDays className="size-3.5" /> Penempatan</Button>
                    <Button variant="outline" size="sm" aria-label={`Ubah siswa ${student.name} ${student.nisn}`} onClick={() => openEditor(student)} className="rounded-lg"><Pencil className="size-3.5" /> Ubah</Button>
                    <Button variant="outline" size="sm" aria-label={`Hapus siswa ${student.name} ${student.nisn}`} onClick={() => setDeleting(student)} className="rounded-lg text-destructive hover:text-destructive"><Trash2 className="size-3.5" /> Hapus</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <StudentEditor student={editing} open={editorOpen} onOpenChange={setEditorOpen} />
      <DeleteStudentDialog student={deleting} onClose={() => setDeleting(null)} />
      <PlacementDialog student={placementStudent} periods={periods} classes={classes} placements={placements} onClose={() => setPlacementStudent(null)} onEnd={setEnding} />
      <EndPlacementDialog target={ending} onClose={() => setEnding(null)} />
    </>
  );
}
