"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { CircleAlert, Info, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveManagedYearStudent, saveYearStudent } from "@/app/data-peserta/siswa/year-actions";
import { useCanDevCascadeDelete } from "@/components/admin-user-context";
import { DevCascadeDeleteDialog } from "@/components/dev-cascade-delete-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { Student } from "@/lib/student-types";

export type YearEnrollment = {
  id: string;
  studentId: string;
  classId: string;
  className: string;
  status: "active" | "graduated" | "left";
  transition: string;
  revision: string;
  name: string;
  nisn: string;
  studentVersion: string;
};

type Props = {
  years: Array<{ id: string; name: string }>;
  selectedYearId: string | null;
  activeYearId: string | null;
  classes: Array<{ id: string; label: string }>;
  students: Student[];
  enrollments: YearEnrollment[];
};

const field = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm";
const statusName = { active: "Aktif", graduated: "Lulus", left: "Keluar" } as const;

export function YearStudentManager({ years, selectedYearId, activeYearId, classes, students, enrollments }: Props) {
  const router = useRouter();
  const canDevCascade = useCanDevCascadeDelete();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [dialog, setDialog] = useState<"new" | "existing" | YearEnrollment | null>(null);
  const [cascadeStudent, setCascadeStudent] = useState<YearEnrollment | null>(null);
  const [error, setError] = useState("");

  const year = years.find((y) => y.id === selectedYearId);
  const inYear = new Set(enrollments.map((r) => r.studentId));
  const available = students.filter((s) => !inYear.has(s.id));
  const q = search.trim().toLocaleLowerCase("id-ID");
  const rows = enrollments.filter(
    (r) => (!classFilter || r.classId === classFilter) && (!q || `${r.name} ${r.nisn}`.toLocaleLowerCase("id-ID").includes(q)),
  );
  const editing = typeof dialog === "object" && dialog !== null ? dialog : null;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedYearId) return;
    const form = new FormData(event.currentTarget);
    form.set("yearId", selectedYearId);
    setError("");

    if (editing) {
      form.set("studentId", editing.studentId);
      form.set("enrollmentId", editing.id);
      form.set("revision", editing.revision);
      form.set("studentVersion", editing.studentVersion);
      start(async () => {
        try {
          const result = await saveManagedYearStudent(form);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setDialog(null);
          toast.success(result.message);
          router.refresh();
        } catch {
          setError("Hasil belum dapat dipastikan. Muat ulang roster dan periksa kembali.");
        }
      });
      return;
    }

    form.set("mode", String(dialog));
    form.set("status", "active");
    start(async () => {
      try {
        const result = await saveYearStudent(form);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setDialog(null);
        toast.success(result.message);
        router.refresh();
      } catch {
        setError("Hasil belum dapat dipastikan. Muat ulang roster dan periksa kembali.");
      }
    });
  }

  return (
    <div className="space-y-5">
      <Alert>
        <Info className="size-4" />
        <AlertTitle>Roster berdasarkan tahun ajaran</AlertTitle>
        <AlertDescription>
          Penempatan aktif disediakan untuk setiap periode dalam tahun yang sama; akun dan sandi tetap dibuat per periode.
          Perubahan kelas atau status siswa dapat mengakhiri sesi peserta aktif, tetapi riwayat tes tidak diubah.
        </AlertDescription>
      </Alert>

      <Card className="gap-0 rounded-[20px] p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="student-year" className="mb-1 block text-xs font-semibold">Tahun ajaran</label>
            <select
              id="student-year"
              className={field}
              value={selectedYearId ?? ""}
              onChange={(e) => router.push(e.target.value ? `/data-peserta/siswa?tahun=${encodeURIComponent(e.target.value)}` : "/data-peserta/siswa")}
            >
              <option value="">Pilih tahun ajaran</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                  {y.id === activeYearId ? " · aktif" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="student-class-filter" className="mb-1 block text-xs font-semibold">Kelas / rombel</label>
            <select id="student-class-filter" className={field} value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option value="">Semua kelas</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="student-search" className="mb-1 block text-xs font-semibold">Nama / NISN</label>
            <input
              id="student-search"
              className={field}
              maxLength={100}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari siswa"
            />
          </div>
        </div>
        {!year ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Pilih atau buat <Link href="/data-peserta/tahun-ajaran" className="font-semibold underline">tahun ajaran</Link> terlebih dahulu.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={!classes.length} onClick={() => { setError(""); setDialog("new"); }}>
              Tambah siswa baru
            </Button>
            <Button variant="outline" disabled={!classes.length || !available.length} onClick={() => { setError(""); setDialog("existing"); }}>
              Tambahkan siswa yang sudah ada
            </Button>
            <Button asChild variant="outline">
              <Link href="/data-peserta/import">Impor Excel</Link>
            </Button>
          </div>
        )}
        {year && !classes.length && (
          <p className="mt-3 text-xs text-muted-foreground">Buat kelas terlebih dahulu pada menu Kelas / Jurusan.</p>
        )}
      </Card>

      {year && (
        <Card className="gap-0 overflow-hidden rounded-[20px] py-0">
          <div className="border-b p-5">
            <h2 className="font-bold">
              Siswa · {year.name} <Badge variant="secondary">{rows.length}</Badge>
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Siswa lulus atau keluar tetap tercatat dan tidak memiliki penempatan aktif di periode tahun ini.
            </p>
          </div>
          {!rows.length ? (
            <p className="p-8 text-sm text-muted-foreground">Tidak ada siswa pada pilihan ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3">Nama</th>
                    <th className="p-3">NISN</th>
                    <th className="p-3">Kelas / rombel</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Tindakan</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-3 font-semibold">{r.name}</td>
                      <td className="p-3 tabular-nums">{r.nisn}</td>
                      <td className="p-3">{r.className}</td>
                      <td className="p-3">
                        <Badge variant={r.status === "active" ? "default" : "secondary"}>{statusName[r.status]}</Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Kelola ${r.name}`}
                            onClick={() => {
                              setError("");
                              setDialog(r);
                            }}
                          >
                            <Pencil className="size-3.5" /> Kelola
                          </Button>
                          {canDevCascade && (
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`Hapus siswa ${r.name} (Mode Dev)`}
                              onClick={() => setCascadeStudent(r)}
                              className="border-amber-400 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"
                            >
                              <Trash2 className="size-3.5" /> Hapus (Mode Dev)
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setDialog(null);
            setError("");
          }
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          showCloseButton={!pending}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing ? `Kelola siswa · ${editing.name}` : dialog === "new" ? "Tambah siswa baru" : "Tambahkan siswa yang sudah ada"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? `Tahun ${year?.name}. Ubah identitas (nama/NISN), kelas, atau status siswa sekaligus dalam satu penyimpanan.`
                : `Tahun ${year?.name}. Perubahan hanya disimpan setelah dikonfirmasi.`}
            </DialogDescription>
          </DialogHeader>
          <form key={editing?.id ?? String(dialog)} onSubmit={save} className="space-y-3">
            {error && (
              <Alert variant="destructive" role="alert">
                <CircleAlert className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {(dialog === "new" || editing !== null) && (
              <>
                <div>
                  <label htmlFor="manage-student-name" className="mb-1 block text-sm font-semibold">Nama siswa</label>
                  <input
                    id="manage-student-name"
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={editing?.name ?? ""}
                    disabled={pending}
                    className={field}
                  />
                </div>
                <div>
                  <label htmlFor="manage-student-nisn" className="mb-1 block text-sm font-semibold">NISN</label>
                  <input
                    id="manage-student-nisn"
                    name="nisn"
                    required
                    inputMode="numeric"
                    pattern="[0-9]{10}"
                    maxLength={10}
                    defaultValue={editing?.nisn ?? ""}
                    disabled={pending}
                    className={field}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {editing
                      ? "Tepat 10 digit; berlaku lintas tahun ajaran sementara snapshot ujian lama tetap tersimpan."
                      : "Tepat 10 digit; nol di depan dipertahankan."}
                  </p>
                </div>
              </>
            )}
            {dialog === "existing" && (
              <div>
                <label htmlFor="existing-student" className="mb-1 block text-sm font-semibold">Siswa</label>
                <select id="existing-student" name="studentId" required defaultValue="" disabled={pending} className={field}>
                  <option value="">Pilih siswa</option>
                  {available.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.nisn}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="year-student-class" className="mb-1 block text-sm font-semibold">Kelas / rombel</label>
              <select
                id="year-student-class"
                name="classId"
                required
                defaultValue={editing?.classId ?? ""}
                disabled={pending}
                className={field}
              >
                <option value="">Pilih kelas</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            {editing && (
              <>
                <div>
                  <label htmlFor="year-student-status" className="mb-1 block text-sm font-semibold">Status siswa</label>
                  <select
                    id="year-student-status"
                    name="status"
                    defaultValue={editing.status}
                    disabled={pending}
                    className={field}
                  >
                    <option value="active">Aktif</option>
                    <option value="graduated">Lulus</option>
                    <option value="left">Keluar</option>
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">Lulus/keluar menyimpan kelas terakhir sebagai riwayat.</p>
                </div>
                <Alert role="note" className="rounded-xl">
                  <Info className="size-4" />
                  <AlertDescription className="text-xs leading-5">
                    Perubahan kelas atau status akan langsung mengakhiri sesi peserta yang sedang aktif pada periode tahun ini, sedangkan riwayat tes tetap tersimpan.
                  </AlertDescription>
                </Alert>
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setDialog(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner aria-hidden="true" />}
                {pending ? "Menyimpan..." : editing ? "Simpan perubahan" : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DevCascadeDeleteDialog
        open={cascadeStudent !== null}
        onOpenChange={(open) => {
          if (!open) setCascadeStudent(null);
        }}
        entityType="student"
        entityId={cascadeStudent?.studentId ?? null}
        entityTitle={cascadeStudent ? `${cascadeStudent.name} (${cascadeStudent.nisn})` : ""}
      />
    </div>
  );
}
