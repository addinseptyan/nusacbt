"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { CircleAlert, Info, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useCanDevCascadeDelete } from "@/components/admin-user-context";
import { DevCascadeDeleteDialog } from "@/components/dev-cascade-delete-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { applyAcademicRollover, createAcademicYear, previewAcademicRollover, setActiveAcademicYear, type RolloverPreview } from "./actions";

export type YearItem = { id: string; name: string; students: number; periods: number };
type Choice = { action: "" | "promoted" | "repeated" | "graduated" | "left" | "keep"; classId: string };
const field = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm";

export function AcademicYearManager({ years, activeYearId, revision }: { years: YearItem[]; activeYearId: string | null; revision: string }) {
  const router = useRouter();
  const canDevCascade = useCanDevCascadeDelete();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [targetYear, setTargetYear] = useState<YearItem | null | undefined>(undefined);
  const [cascadeYear, setCascadeYear] = useState<YearItem | null>(null);
  const [source, setSource] = useState(""); const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<RolloverPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [confirmRollover, setConfirmRollover] = useState(false);
  const activeYear = years.find((y) => y.id === activeYearId);

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setError("");
    start(async () => { try { const result = await createAcademicYear(form); if (!result.ok) { setError(result.error); return; } formElement.reset(); toast.success(result.message); router.refresh(); } catch { setError("Hasil belum dapat dipastikan. Muat ulang halaman."); } });
  }
  function activate() {
    const form = new FormData(); form.set("yearId", targetYear?.id ?? ""); form.set("expectedYearId", activeYearId ?? ""); form.set("revision", revision); setError("");
    start(async () => { try { const result = await setActiveAcademicYear(form); if (!result.ok) { setError(result.error); return; } setTargetYear(undefined); toast.success(result.message); router.refresh(); } catch { setError("Hasil belum dapat dipastikan. Muat ulang halaman."); } });
  }
  function makePreview() {
    setError(""); setPreview(null);
    start(async () => { try { const result = await previewAcademicRollover(source, target); if (!result.ok) { setError(result.error); return; }
      const next: Record<string, Choice> = {}; for (const row of result.preview.rows) next[row.studentId] = row.alreadyExists ? { action: "keep", classId: "" } : { action: row.suggestedClassId ? "promoted" : "", classId: row.suggestedClassId ?? "" };
      setChoices(next); setPreview(result.preview);
    } catch { setError("Pratinjau belum dapat dibuat. Muat ulang dan coba lagi."); } });
  }
  const complete = Boolean(preview?.rows.length && preview.rows.every((row) => {
    const choice = choices[row.studentId]; return choice?.action && (!["promoted", "repeated"].includes(choice.action) || choice.classId);
  }));
  function saveRollover() {
    if (!preview || !complete) return;
    const form = new FormData(); form.set("source", source); form.set("target", target); form.set("token", preview.token);
    form.set("choices", JSON.stringify(preview.rows.map((r) => ({ studentId: r.studentId, ...choices[r.studentId] })))); setError("");
    start(async () => { try { const result = await applyAcademicRollover(form); if (!result.ok) { setError(result.error); setConfirmRollover(false); return; }
      setPreview(null); setConfirmRollover(false); toast.success(result.message); router.refresh();
    } catch { setError("Hasil belum dapat dipastikan. Periksa roster tujuan sebelum mencoba lagi."); setConfirmRollover(false); } });
  }
  return <div className="space-y-5">
    <Alert><Info className="size-4" /><AlertTitle>Satu tahun aktif</AlertTitle><AlertDescription>Periode ujian dan roster siswa berada di dalam tahun ajaran. Mengganti atau menonaktifkan tahun menonaktifkan semua periode login aktif di tahun lama dan mengakhiri sesi peserta; aktifkan periode baru secara manual setelah siap.</AlertDescription></Alert>
    {error && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertTitle>Belum dapat dilanjutkan</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    <Card className="gap-0 rounded-[20px] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">Daftar tahun ajaran</h2><p className="mt-1 text-xs text-muted-foreground">Aktif: <strong>{activeYear?.name ?? "belum ada"}</strong>. Tahun lama tetap dapat dilihat.</p></div>{activeYear && <Button variant="outline" size="sm" disabled={pending} onClick={() => setTargetYear(null)}>Nonaktifkan tahun</Button>}</div>
      <form onSubmit={create} className="mt-4 flex flex-wrap items-end gap-2"><div className="w-48"><label htmlFor="year-name" className="mb-1 block text-xs font-semibold">Tahun ajaran baru</label><input id="year-name" name="name" required placeholder="2026/2027" maxLength={9} className={field} /></div><Button type="submit" disabled={pending}>{pending && <Spinner aria-hidden="true" />}Tambah tahun</Button></form>
      <ul className="mt-4 divide-y border-t">{years.map((year) => <li key={year.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><strong className="text-sm">{year.name}</strong> {year.id === activeYearId && <Badge>Aktif</Badge>}<p className="mt-1 text-xs text-muted-foreground">{year.students} siswa aktif · {year.periods} periode</p></div><div className="flex flex-wrap gap-2">{year.id !== activeYearId && <Button size="sm" variant="outline" disabled={pending} onClick={() => setTargetYear(year)}>Aktifkan {year.name}</Button>}{canDevCascade && <Button size="sm" variant="outline" disabled={pending} aria-label={`Hapus tahun ajaran ${year.name} (Mode Dev)`} onClick={() => setCascadeYear(year)} className="border-amber-400 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"><Trash2 className="size-3.5" /> Hapus (Mode Dev)</Button>}</div></li>)}</ul>
      {!years.length && <p className="pt-4 text-sm text-muted-foreground">Belum ada tahun ajaran. Tambahkan terlebih dahulu.</p>}
    </Card>
    <Card className="gap-0 rounded-[20px] p-5"><h2 className="font-bold">Perpindahan siswa ke tahun baru</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Sistem mengusulkan X → XI dan XI → XII pada jurusan yang sama jika kelas tujuan tersedia. Periksa setiap siswa; kelas XII dan kelas tanpa usulan harus ditentukan sendiri. Hanya siswa berstatus aktif pada tahun asal yang disertakan.</p>
      <div className="mt-4 grid items-end gap-3 sm:grid-cols-3"><div><label htmlFor="roll-source" className="mb-1 block text-xs font-semibold">Tahun asal</label><select id="roll-source" className={field} value={source} disabled={pending} onChange={(e) => { setSource(e.target.value); setPreview(null); }}><option value="">Pilih tahun</option>{years.map((y) => <option value={y.id} key={y.id}>{y.name}</option>)}</select></div>
      <div><label htmlFor="roll-target" className="mb-1 block text-xs font-semibold">Tahun tujuan</label><select id="roll-target" className={field} value={target} disabled={pending} onChange={(e) => { setTarget(e.target.value); setPreview(null); }}><option value="">Pilih tahun</option>{years.map((y) => <option value={y.id} key={y.id}>{y.name}</option>)}</select></div>
      <Button type="button" onClick={makePreview} disabled={pending || !source || !target || source === target}>{pending && <Spinner aria-hidden="true" />}Buat pratinjau</Button></div>
      {preview && <div className="mt-5 space-y-3"><p className="text-sm"><strong>{preview.sourceName} → {preview.targetName}</strong> · {preview.rows.length} siswa</p>
        {preview.conflicts > 0 && <Alert><Info className="size-4" /><AlertTitle>Siswa yang sudah ada dipertahankan</AlertTitle><AlertDescription>{preview.conflicts} siswa sudah tercatat pada tahun tujuan dan tidak akan ditimpa. Periksa roster tujuan bila perlu.</AlertDescription></Alert>}
        {!preview.rows.length ? <p className="text-sm text-muted-foreground">Tidak ada siswa aktif pada tahun asal.</p> : <div className="max-h-[36rem] overflow-auto rounded-xl border"><table className="w-full min-w-[700px] text-left text-sm"><thead className="sticky top-0 bg-muted text-xs"><tr><th className="p-3">Siswa</th><th className="p-3">Kelas asal</th><th className="p-3">Keputusan</th><th className="p-3">Kelas tujuan</th></tr></thead><tbody>{preview.rows.map((row) => {
          const choice = choices[row.studentId] ?? { action: "", classId: "" };
          return <tr key={row.studentId} className="border-t"><td className="p-3"><strong>{row.name}</strong><br /><span className="text-xs text-muted-foreground">{row.nisn}{row.alreadyExists ? " · Sudah ada di tujuan" : ""}</span></td><td className="p-3">{row.className}</td><td className="p-3">{row.alreadyExists ? <span className="text-xs">Tetap: data tujuan</span> : <select aria-label={`Keputusan ${row.name} ${row.nisn}`} className={field} value={choice.action} disabled={pending} onChange={(e) => { const action = e.target.value as Choice["action"]; setChoices((old) => ({ ...old, [row.studentId]: { action, classId: action === "repeated" ? row.classId : action === "promoted" ? row.suggestedClassId ?? "" : "" } })); }}><option value="">Tentukan</option><option value="promoted">Naik kelas</option><option value="repeated">Tinggal kelas</option><option value="graduated">Lulus</option><option value="left">Keluar</option></select>}</td><td className="p-3">{choice.action === "promoted" || choice.action === "repeated" ? <select aria-label={`Kelas tujuan ${row.name} ${row.nisn}`} className={field} value={choice.classId} disabled={pending} onChange={(e) => setChoices((old) => ({ ...old, [row.studentId]: { ...choice, classId: e.target.value } }))}><option value="">Pilih kelas</option>{preview.classes.map((c) => <option value={c.id} key={c.id}>{c.label}</option>)}</select> : <span className="text-xs text-muted-foreground">{choice.action === "keep" ? "Data tujuan dipertahankan" : choice.action ? "Tidak ditempatkan" : "Tentukan keputusan"}</span>}</td></tr>;
        })}</tbody></table></div>}
        <div className="flex flex-wrap items-center gap-3"><Button type="button" onClick={() => setConfirmRollover(true)} disabled={pending || !complete}>Periksa dan simpan perpindahan</Button>{!complete && preview.rows.length > 0 && <span className="text-xs text-muted-foreground">Lengkapi keputusan dan kelas semua siswa sebelum menyimpan.</span>}</div>
      </div>}
    </Card>
    <p className="text-xs text-muted-foreground">Tambahkan siswa baru di <Link href="/data-peserta/siswa" className="font-semibold underline">Data Siswa</Link> atau melalui impor Excel.</p>
    <Dialog open={targetYear !== undefined} onOpenChange={(open) => { if (!open && !pending) { setTargetYear(undefined); setError(""); } }}><DialogContent><DialogHeader><DialogTitle>{targetYear ? `Aktifkan ${targetYear.name}?` : "Nonaktifkan tahun ajaran?"}</DialogTitle><DialogDescription>Semua periode login pada tahun sebelumnya akan dinonaktifkan dan seluruh sesi peserta diakhiri. Riwayat, akun dan sandi tetap disimpan. Admin perlu mengaktifkan periode login yang sesuai secara manual.</DialogDescription></DialogHeader>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={pending} onClick={() => setTargetYear(undefined)}>Batal</Button><Button disabled={pending} onClick={activate}>{pending && <Spinner aria-hidden="true" />}Ya, lanjutkan</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={confirmRollover} onOpenChange={(open) => { if (!pending) setConfirmRollover(open); }}><DialogContent><DialogHeader><DialogTitle>Simpan perpindahan siswa?</DialogTitle><DialogDescription>{preview?.rows.length} siswa diperiksa dari {preview?.sourceName} ke {preview?.targetName}. Siswa yang sudah ada di tujuan tidak ditimpa. Siswa lulus/keluar tercatat sebagai riwayat dan tidak ditempatkan pada periode tujuan. Data sumber tidak dihapus.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setConfirmRollover(false)}>Batal</Button><Button disabled={pending} onClick={saveRollover}>{pending && <Spinner aria-hidden="true" />}Ya, simpan</Button></DialogFooter></DialogContent></Dialog>
    <DevCascadeDeleteDialog
      open={cascadeYear !== null}
      onOpenChange={(open) => { if (!open) setCascadeYear(null); }}
      entityType="academic_year"
      entityId={cascadeYear?.id ?? null}
      entityTitle={cascadeYear?.name ?? ""}
    />
  </div>;
}
