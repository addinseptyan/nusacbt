"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, GraduationCap, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteClass, deleteMajor, saveClass, saveMajor } from "@/app/data-peserta/kelas/actions";
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
import type { SchoolClass, SchoolMajor } from "@/lib/class-types";

const dialogClass = "max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md";

function MajorEditor({ major, open, onOpenChange }: { major: SchoolMajor | null; open: boolean; onOpenChange: (open: boolean) => void }) {
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
    if (major) formData.set("id", major.id);
    setError("");
    startTransition(async () => {
      try {
        const result = await saveMajor(formData);
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
          <DialogTitle className="text-lg font-bold">{major ? "Ubah jurusan" : "Tambah jurusan"}</DialogTitle>
          <DialogDescription>{major ? "Perubahan nama jurusan juga mengubah tampilan nama kelas yang menggunakannya." : "Masukkan nama atau kode jurusan, misalnya AK, BD, atau TKR."}</DialogDescription>
        </DialogHeader>
        <form key={`${major?.id ?? "baru"}-${open}`} onSubmit={handleSubmit} className="space-y-4 pt-2">
          {error && <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-2">
            <label htmlFor="major-name" className="text-sm font-semibold">Nama / kode jurusan <span className="text-destructive">*</span></label>
            <Input id="major-name" name="name" maxLength={60} defaultValue={major?.name ?? ""} placeholder="Contoh: AK" required disabled={pending} className="h-11 rounded-xl" />
            <p className="text-[11px] leading-5 text-muted-foreground">Nama yang sama tidak dapat ditambahkan meskipun berbeda huruf besar atau kecil.</p>
          </div>
          <DialogFooter className="mt-5 -mx-4 -mb-4 rounded-b-2xl">
            <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>Batal</Button>
            <Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan jurusan"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClassEditor({ schoolClass, majors, open, onOpenChange }: { schoolClass: SchoolClass | null; majors: SchoolMajor[]; open: boolean; onOpenChange: (open: boolean) => void }) {
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
    if (schoolClass) formData.set("id", schoolClass.id);
    if (!formData.get("majorId")) return setError("Pilih jurusan terlebih dahulu.");
    setError("");
    startTransition(async () => {
      try {
        const result = await saveClass(formData);
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
          <DialogTitle className="text-lg font-bold">{schoolClass ? "Ubah kelas" : "Tambah kelas"}</DialogTitle>
          <DialogDescription>Gabungkan tingkat dan jurusan. Contoh: tingkat X dan jurusan AK menjadi kelas X AK.</DialogDescription>
        </DialogHeader>
        <form key={`${schoolClass?.id ?? "baru"}-${open}`} onSubmit={handleSubmit} className="space-y-4 pt-2">
          {error && <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-2">
            <label htmlFor="class-level" className="text-sm font-semibold">Tingkat <span className="text-destructive">*</span></label>
            <Input id="class-level" name="level" maxLength={12} defaultValue={schoolClass?.level ?? ""} placeholder="Contoh: X, XI, XII" required disabled={pending} className="h-11 rounded-xl" />
            <p className="text-[11px] leading-5 text-muted-foreground">Gunakan huruf atau angka tanpa spasi. Huruf disimpan sebagai huruf besar.</p>
          </div>
          <div className="space-y-2">
            <label htmlFor="class-major" className="text-sm font-semibold">Jurusan <span className="text-destructive">*</span></label>
            <Select name="majorId" defaultValue={schoolClass?.majorId} disabled={pending}>
              <SelectTrigger id="class-major" aria-required="true" className="h-11! w-full rounded-xl"><SelectValue placeholder="Pilih jurusan" /></SelectTrigger>
              <SelectContent position="popper">
                {majors.map((major) => <SelectItem key={major.id} value={major.id}>{major.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-5 text-muted-foreground">Satu kombinasi tingkat dan jurusan hanya dapat dibuat satu kali.</p>
          </div>
          <DialogFooter className="mt-5 -mx-4 -mb-4 rounded-b-2xl">
            <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>Batal</Button>
            <Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan kelas"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DeleteTarget = { type: "kelas" | "jurusan"; id: string; name: string };

function DeleteDialog({ target, onClose }: { target: DeleteTarget | null; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setError("");
    onClose();
  }

  function handleDelete() {
    if (!target) return;
    const formData = new FormData();
    formData.set("id", target.id);
    setError("");
    startTransition(async () => {
      try {
        const result = target.type === "kelas" ? await deleteClass(formData) : await deleteMajor(formData);
        if (!result.ok) return setError(result.error);
        onClose();
        toast.success(result.message);
        router.refresh();
      } catch {
        setError("Hasil penghapusan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar sebelum mencoba lagi.");
      }
    });
  }

  const title = target?.type === "jurusan" ? "jurusan" : "kelas";
  return (
    <Dialog open={target !== null} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className={dialogClass} showCloseButton={!pending} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Hapus {title}?</DialogTitle>
          <DialogDescription><strong className="text-foreground">{target?.name}</strong> akan dihapus permanen.{target?.type === "jurusan" && " Jurusan tidak dapat dihapus jika masih digunakan oleh kelas."} Tindakan ini tidak dapat dibatalkan.</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive" role="alert"><Info className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter className="rounded-b-2xl">
          <Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={handleDelete}>{pending ? "Menghapus..." : `Ya, hapus ${title}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClassManager({ classes, majors }: { classes: SchoolClass[]; majors: SchoolMajor[] }) {
  const [majorOpen, setMajorOpen] = useState(false);
  const [editingMajor, setEditingMajor] = useState<SchoolMajor | null>(null);
  const [classOpen, setClassOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<SchoolClass | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);

  function openMajor(major: SchoolMajor | null) {
    setEditingMajor(major);
    setMajorOpen(true);
  }

  function openClass(schoolClass: SchoolClass | null) {
    setEditingClass(schoolClass);
    setClassOpen(true);
  }

  return (
    <>
      <Alert className="mb-6 max-w-4xl rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200">
        <Info className="size-4 text-[#727fc8] dark:text-indigo-300" />
        <AlertTitle className="text-[12px] font-bold">Daftar kelas bersama</AlertTitle>
        <AlertDescription className="mt-0.5 text-[12px] leading-5 text-[#6873a0] dark:text-indigo-200/70">Buat jurusan terlebih dahulu, lalu gabungkan dengan tingkat. Daftar disiapkan untuk lintas periode; penempatan dan riwayat siswa belum aktif.</AlertDescription>
      </Alert>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <Card className="gap-0 overflow-hidden rounded-[18px] bg-card py-0 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5 sm:px-6">
            <div><div className="flex items-center gap-2.5"><h2 className="text-[15px] font-bold">Daftar jurusan</h2><Badge variant="secondary" className="rounded-full text-[10px]">{majors.length} jurusan</Badge></div><p className="mt-1 text-[12px] text-muted-foreground">Contoh: AK, BD, atau TKR.</p></div>
            <Button onClick={() => openMajor(null)} className="h-10 rounded-xl px-4 font-semibold"><Plus className="size-4" /> Tambah jurusan</Button>
          </div>
          {majors.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center"><BookOpenText className="size-7 text-muted-foreground" /><h3 className="mt-4 text-sm font-bold">Belum ada jurusan</h3><p className="mt-1.5 text-[12px] leading-6 text-muted-foreground">Tambahkan jurusan sebelum membuat kelas.</p></div>
          ) : (
            <ul aria-label="Daftar jurusan" className="divide-y divide-border">
              {majors.map((major) => (
                <li key={major.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:px-6">
                  <div className="flex min-w-0 flex-1 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"><BookOpenText className="size-4" /></span><h3 className="min-w-0 break-words text-[13px] font-bold">{major.name}</h3></div>
                  <div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" aria-label={`Ubah jurusan ${major.name}`} onClick={() => openMajor(major)} className="rounded-lg"><Pencil className="size-3.5" /> Ubah</Button><Button variant="outline" size="sm" aria-label={`Hapus jurusan ${major.name}`} onClick={() => setDeleting({ type: "jurusan", id: major.id, name: major.name })} className="rounded-lg text-destructive hover:text-destructive"><Trash2 className="size-3.5" /> Hapus</Button></div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="gap-0 overflow-hidden rounded-[18px] bg-card py-0 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5 sm:px-6">
            <div><div className="flex items-center gap-2.5"><h2 className="text-[15px] font-bold">Daftar kelas</h2><Badge variant="secondary" className="rounded-full text-[10px]">{classes.length} kelas</Badge></div><p className="mt-1 text-[12px] text-muted-foreground">Satu kelas untuk setiap tingkat dan jurusan.</p></div>
            <Button onClick={() => openClass(null)} disabled={majors.length === 0} className="h-10 rounded-xl px-4 font-semibold"><Plus className="size-4" /> Tambah kelas</Button>
          </div>
          {classes.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center"><GraduationCap className="size-7 text-muted-foreground" /><h3 className="mt-4 text-sm font-bold">Belum ada kelas</h3><p className="mt-1.5 text-[12px] leading-6 text-muted-foreground">{majors.length === 0 ? "Buat jurusan terlebih dahulu untuk menambahkan kelas." : "Tambahkan kelas berdasarkan tingkat dan jurusan."}</p></div>
          ) : (
            <ul aria-label="Daftar kelas" className="divide-y divide-border">
              {classes.map((schoolClass) => {
                const name = `${schoolClass.level} ${schoolClass.majorName}`;
                return (
                  <li key={schoolClass.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:px-6">
                    <div className="flex min-w-0 flex-1 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><GraduationCap className="size-4" /></span><div className="min-w-0"><h3 className="break-words text-[13px] font-bold">{name}</h3><p className="mt-1 break-words text-[11px] text-muted-foreground">Tingkat {schoolClass.level} · {schoolClass.majorName}</p></div></div>
                    <div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" aria-label={`Ubah kelas ${name}`} onClick={() => openClass(schoolClass)} className="rounded-lg"><Pencil className="size-3.5" /> Ubah</Button><Button variant="outline" size="sm" aria-label={`Hapus kelas ${name}`} onClick={() => setDeleting({ type: "kelas", id: schoolClass.id, name })} className="rounded-lg text-destructive hover:text-destructive"><Trash2 className="size-3.5" /> Hapus</Button></div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      <MajorEditor major={editingMajor} open={majorOpen} onOpenChange={setMajorOpen} />
      <ClassEditor schoolClass={editingClass} majors={majors} open={classOpen} onOpenChange={setClassOpen} />
      <DeleteDialog target={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}
