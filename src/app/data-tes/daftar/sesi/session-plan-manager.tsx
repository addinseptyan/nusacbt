"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronRight, CircleAlert, Info, Plus, Shuffle, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { saveSessionPlan } from "@/app/data-tes/daftar/sesi/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  applyClassCheckboxToggle,
  applyClassSessionAssignment,
  filterSessionClassGroups,
  groupSessionStudentsByClass,
  summarizeClassSelection,
} from "@/lib/exam-session-grouping.mjs";
import { distributeExamSessions, SESSION_MAX_CAPACITY, SESSION_MAX_GROUPS } from "@/lib/exam-session-validation.mjs";
import type { SessionPlanPage, SessionStudent } from "@/lib/exam-session-types";

const selectClass = "h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";
const CLASS_PAGE_SIZE = 25;
const GROUPS_PER_PAGE = 10;
type Notice = { message: string; reload?: boolean } | null;

function ClassCheckbox({
  checked,
  indeterminate,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className="size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
    />
  );
}

export function SessionPlanManager({ data }: { data: SessionPlanPage }) {
  const router = useRouter();
  const { selected, students } = data;
  const [changing, startChanging] = useTransition();
  const [pending, startSaving] = useTransition();
  const [capacities, setCapacities] = useState<string[]>(data.groups.length ? data.groups.map((g) => String(g.capacity)) : ["30"]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(students.filter((s) => s.sessionNumber !== null).map((s) => s.studentId)));
  const [assignments, setAssignments] = useState<Map<string, number>>(
    () => new Map(students.filter((s) => s.sessionNumber !== null).map((s) => [s.studentId, s.sessionNumber as number])),
  );
  const [query, setQuery] = useState("");
  const [sessionFilter, setSessionFilter] = useState("all");
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(() => new Set());
  const [classPages, setClassPages] = useState<Record<string, number>>({});
  const [groupPage, setGroupPage] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<Notice>(null);

  const classGroups = useMemo(() => groupSessionStudentsByClass(students), [students]);
  const visibleGroups = useMemo(
    () => filterSessionClassGroups(classGroups, query, sessionFilter, chosen, assignments),
    [classGroups, query, sessionFilter, chosen, assignments],
  );
  const groupPages = Math.max(1, Math.ceil(visibleGroups.length / GROUPS_PER_PAGE));
  const safeGroupPage = Math.min(groupPage, groupPages - 1);
  const pagedGroups = visibleGroups.slice(safeGroupPage * GROUPS_PER_PAGE, (safeGroupPage + 1) * GROUPS_PER_PAGE);

  const capacitiesAsNumbers = capacities.map((value) => (/^\d+$/.test(value) ? Number(value) : 0));
  const selectedRows = students.filter((row) => chosen.has(row.studentId));
  const totals = capacities.map((_, index) =>
    selectedRows.reduce((sum, row) => (assignments.get(row.studentId) === index + 1 ? sum + 1 : sum), 0),
  );
  const outOfRangeCount = selectedRows.reduce((count, row) => {
    const num = assignments.get(row.studentId);
    return num === undefined || !Number.isInteger(num) || num < 1 || num > capacities.length ? count + 1 : count;
  }, 0);
  const invalidCapacity = capacitiesAsNumbers.some((n) => !Number.isInteger(n) || n < 1 || n > SESSION_MAX_CAPACITY);
  const overCapacity = totals.some((count, index) => count > capacitiesAsNumbers[index]);
  const hasAnyActive = students.some((row) => row.active);
  const allActiveSelected = hasAnyActive && students.every((row) => !row.active || chosen.has(row.studentId));

  function toggleStudent(row: SessionStudent, checked: boolean) {
    const nextChosen = new Set(chosen);
    const nextAssignments = new Map(assignments);
    if (checked) {
      nextChosen.add(row.studentId);
      if (!nextAssignments.has(row.studentId)) {
        const fallback = row.sessionNumber && row.sessionNumber >= 1 && row.sessionNumber <= capacities.length ? row.sessionNumber : 1;
        nextAssignments.set(row.studentId, fallback);
      }
    } else {
      nextChosen.delete(row.studentId);
      nextAssignments.delete(row.studentId);
    }
    setChosen(nextChosen);
    setAssignments(nextAssignments);
    setError(null);
  }

  function toggleClass(groupStudents: SessionStudent[], checked: boolean) {
    const { nextChosen, nextAssignments } = applyClassCheckboxToggle(groupStudents, chosen, assignments, checked, 1);
    setChosen(nextChosen);
    setAssignments(nextAssignments);
    setError(null);
  }

  function assignClassSession(groupStudents: SessionStudent[], value: string) {
    if (!/^\d+$/.test(value)) return;
    const sessionNumber = Number(value);
    if (sessionNumber < 1 || sessionNumber > capacities.length) return;
    const { nextChosen, nextAssignments } = applyClassSessionAssignment(groupStudents, chosen, assignments, sessionNumber);
    setChosen(nextChosen);
    setAssignments(nextAssignments);
    setError(null);
  }

  function changeStudentSession(studentId: string, value: string) {
    if (!/^\d+$/.test(value)) return;
    const sessionNumber = Number(value);
    if (sessionNumber < 1 || sessionNumber > capacities.length) return;
    const next = new Map(assignments);
    next.set(studentId, sessionNumber);
    setAssignments(next);
    setError(null);
  }

  function selectAllActive() {
    const { nextChosen, nextAssignments } = applyClassCheckboxToggle(students, chosen, assignments, true, 1);
    setChosen(nextChosen);
    setAssignments(nextAssignments);
    setError(null);
  }

  function clearAllSelection() {
    setChosen(new Set());
    setAssignments(new Map());
    setError(null);
  }

  function toggleExpand(id: string) {
    const next = new Set(expandedClasses);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedClasses(next);
  }

  function generate() {
    setError(null);
    const result = distributeExamSessions(
      selectedRows.map((row) => ({ studentId: row.studentId, classId: row.classId, sessionNumber: row.sessionNumber })),
      capacitiesAsNumbers,
    );
    if (!result.ok) {
      setError({ message: result.error });
      return;
    }
    setAssignments(new Map(result.assignments.map((item) => [item.studentId, item.sessionNumber])));
  }

  function save() {
    if (!selected || invalidCapacity || overCapacity || outOfRangeCount > 0) return;
    const payloadAssignments = selectedRows.map((row) => ({
      studentId: row.studentId,
      placementId: row.placementId,
      sessionNumber: assignments.get(row.studentId),
    }));
    const payload = {
      periodId: selected.id,
      expectedRevision: data.revision,
      capacities: capacitiesAsNumbers,
      assignments: payloadAssignments,
    };
    const form = new FormData();
    form.set("plan", JSON.stringify(payload));
    setError(null);
    startSaving(async () => {
      try {
        const result = await saveSessionPlan(form);
        if (!result.ok) {
          setConfirming(false);
          setError({ message: result.error, reload: result.reload });
          return;
        }
        setConfirming(false);
        toast.success(result.message);
        router.refresh();
      } catch {
        setConfirming(false);
        setError({ message: "Hasil penyimpanan belum dapat dipastikan. Muat ulang sebelum mencoba lagi.", reload: true });
      }
    });
  }

  return (
    <div className="max-w-6xl space-y-5">
      <Button asChild variant="ghost" size="sm">
        <Link href="/data-tes/daftar">
          <ArrowLeft className="size-4" /> Kembali ke Daftar Tes
        </Link>
      </Button>

      <Alert className="rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200">
        <Info className="size-4" />
        <AlertTitle>Pembagian tetap per periode</AlertTitle>
        <AlertDescription className="text-xs leading-5">
          Atur kapasitas sesi, centang kelas atau siswa, lalu sesuaikan sesi per kelas atau per siswa — atau klik{" "}
          <strong>Acak pembagian</strong> untuk menyebar siswa baru secara merata. Siswa yang sudah tersimpan tetap pada sesi
          sebelumnya sampai Anda memindahkannya dan menyimpan.
        </AlertDescription>
      </Alert>

      <Card className="gap-0 rounded-2xl p-5 sm:p-6">
        <label htmlFor="session-period" className="mb-2 block text-sm font-semibold">
          Periode <span className="text-destructive">*</span>
        </label>
        <select
          id="session-period"
          value={selected?.id ?? ""}
          onChange={(event) =>
            startChanging(() =>
              router.push(
                event.target.value ? `/data-tes/daftar/sesi?periode=${encodeURIComponent(event.target.value)}` : "/data-tes/daftar/sesi",
              ),
            )
          }
          disabled={changing || pending}
          className={`${selectClass} max-w-lg`}
        >
          <option value="">Pilih periode</option>
          {data.periods.map((period) => (
            <option key={period.id} value={period.id}>
              {period.name} · {period.startDate}
            </option>
          ))}
        </select>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Periode ini untuk pembagian kelompok; tidak mengubah periode login yang dipilih admin.
        </p>
      </Card>

      {data.selectionMissing && (
        <Alert variant="destructive" role="alert">
          <CircleAlert className="size-4" />
          <AlertTitle>Periode tidak ditemukan</AlertTitle>
          <AlertDescription>Pilih periode yang tersedia.</AlertDescription>
        </Alert>
      )}

      {selected && (
        <>
          <Card className="gap-0 rounded-2xl p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">1. Jumlah dan kapasitas sesi</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Kapasitas adalah jumlah maksimal siswa dalam kelompok pada periode ini. Atur sesuai jumlah komputer; maksimal{" "}
                  {SESSION_MAX_GROUPS} sesi.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={capacities.length >= SESSION_MAX_GROUPS || pending}
                onClick={() => {
                  setCapacities((old) => [...old, "30"]);
                  setError(null);
                }}
              >
                <Plus className="size-4" /> Tambah sesi
              </Button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {capacities.map((capacity, index) => (
                <div key={index} className="rounded-xl border p-3">
                  <label htmlFor={`capacity-${index + 1}`} className="mb-1.5 block text-xs font-semibold">
                    Kapasitas sesi {index + 1}
                  </label>
                  <Input
                    id={`capacity-${index + 1}`}
                    type="number"
                    min={1}
                    max={SESSION_MAX_CAPACITY}
                    step={1}
                    value={capacity}
                    disabled={pending}
                    onChange={(event) => {
                      const next = [...capacities];
                      next[index] = event.target.value;
                      setCapacities(next);
                      setError(null);
                    }}
                    className="h-10"
                  />
                </div>
              ))}
            </div>
            {capacities.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3 self-start"
                disabled={pending}
                onClick={() => {
                  const newLen = capacities.length - 1;
                  setCapacities((old) => old.slice(0, -1));
                  if (sessionFilter === `session:${capacities.length}`) setSessionFilter("all");
                  if (newLen > 0) setError(null);
                }}
              >
                Hapus sesi terakhir
              </Button>
            )}
            {invalidCapacity && (
              <p role="alert" className="mt-3 text-xs text-destructive">
                Isi kapasitas 1–{SESSION_MAX_CAPACITY} untuk setiap sesi.
              </p>
            )}
          </Card>

          <Card className="gap-0 rounded-2xl p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">2. Pilih siswa dan sesuaikan</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Centang per kelas untuk memilih semua siswa di bawahnya sekaligus, atau centang per siswa. Sesuaikan sesi per
                  kelas maupun per nama siswa, atau gunakan acak pembagian.
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0">
                {chosen.size} siswa dipilih
              </Badge>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {capacities.map((_, i) => (
                <div
                  key={i}
                  className={`rounded-xl border p-3 text-xs ${
                    totals[i] > capacitiesAsNumbers[i] ? "border-destructive text-destructive" : ""
                  }`}
                >
                  <p className="font-semibold">Sesi {i + 1}</p>
                  <p className="mt-1 tabular-nums">
                    {totals[i]} / {capacitiesAsNumbers[i]} siswa
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
                <div className="w-full min-w-44 max-w-xs space-y-1.5">
                  <label htmlFor="session-student-search" className="block text-xs font-semibold">
                    Cari siswa atau kelas
                  </label>
                  <Input
                    id="session-student-search"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setGroupPage(0);
                      setClassPages({});
                    }}
                    placeholder="Nama, NISN, atau kelas"
                    className="h-10"
                  />
                </div>
                <div className="w-full max-w-44 space-y-1.5">
                  <label htmlFor="session-view-filter" className="block text-xs font-semibold">
                    Filter tampilan
                  </label>
                  <select
                    id="session-view-filter"
                    value={sessionFilter}
                    onChange={(event) => {
                      setSessionFilter(event.target.value);
                      setGroupPage(0);
                      setClassPages({});
                    }}
                    disabled={pending}
                    className={selectClass}
                  >
                    <option value="all">Semua siswa</option>
                    <option value="selected">Sudah dipilih</option>
                    <option value="unselected">Belum dipilih</option>
                    {capacities.map((_, i) => (
                      <option key={i} value={`session:${i + 1}`}>
                        Hanya Sesi {i + 1}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {hasAnyActive && !allActiveSelected && (
                  <Button type="button" variant="outline" size="sm" disabled={pending} onClick={selectAllActive}>
                    Pilih semua kelas
                  </Button>
                )}
                {chosen.size > 0 && (
                  <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={clearAllSelection}>
                    Kosongkan pilihan
                  </Button>
                )}
                <Button type="button" variant="outline" disabled={invalidCapacity || pending} onClick={generate}>
                  <Shuffle className="size-4" /> Acak pembagian
                </Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Siswa yang sudah tersimpan tidak diacak ulang saat menekan Acak pembagian.
            </p>

            {overCapacity && (
              <p role="alert" className="mt-3 text-xs font-medium text-destructive">
                Ada sesi yang melebihi kapasitas. Pindahkan siswa sebelum menyimpan.
              </p>
            )}
            {outOfRangeCount > 0 && (
              <p role="alert" className="mt-3 text-xs font-medium text-destructive">
                Ada {outOfRangeCount} siswa pada sesi yang sudah dihapus. Sesuaikan ke sesi yang tersedia atau klik Acak
                pembagian.
              </p>
            )}

            {!pagedGroups.length ? (
              <p className="mt-4 rounded-xl bg-muted/50 p-4 text-xs">
                {students.length
                  ? "Tidak ada siswa atau kelas yang cocok dengan filter."
                  : "Belum ada siswa dengan penempatan aktif pada periode ini."}
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {pagedGroups.map((group) => {
                  const summary = summarizeClassSelection(group.students, chosen, assignments, capacities.length);
                  const expanded = Boolean(query.trim()) || expandedClasses.has(group.classId);
                  const cPages = Math.max(1, Math.ceil(group.students.length / CLASS_PAGE_SIZE));
                  const cPage = Math.min(classPages[group.classId] ?? 0, cPages - 1);
                  const visibleGroupStudents = group.students.slice(cPage * CLASS_PAGE_SIZE, (cPage + 1) * CLASS_PAGE_SIZE);

                  return (
                    <section key={group.classId} className="overflow-hidden rounded-xl border">
                      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-muted/40 px-3.5 py-2.5">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <ClassCheckbox
                            label={`Pilih kelas ${group.classLabel}`}
                            checked={summary.allActiveChecked}
                            indeterminate={summary.indeterminate}
                            disabled={pending || summary.activeCount === 0}
                            onChange={(checked) => toggleClass(group.students, checked)}
                          />
                          <button
                            type="button"
                            onClick={() => toggleExpand(group.classId)}
                            aria-expanded={expanded}
                            aria-label={`Tampilkan atau sembunyikan siswa kelas ${group.classLabel}`}
                            className="flex min-w-0 items-center gap-1.5 text-left text-xs font-bold sm:text-sm"
                          >
                            {expanded ? (
                              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate">{group.classLabel}</span>
                          </button>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {summary.checkedCount}/{group.students.length} dipilih
                          </Badge>
                        </div>

                        <div className="flex w-full items-center gap-2 sm:w-auto">
                          <select
                            aria-label={`Sesi kelas ${group.classLabel}`}
                            value={summary.classSessionValue}
                            disabled={pending || summary.activeCount === 0}
                            onChange={(event) => assignClassSession(group.students, event.target.value)}
                            className={`${selectClass} h-9! text-xs sm:w-44`}
                          >
                            <option value="">Atur sesi kelas...</option>
                            {summary.classSessionValue === "mixed" && (
                              <option value="mixed" disabled>
                                Campuran (per siswa)
                              </option>
                            )}
                            {capacities.map((_, i) => (
                              <option key={i} value={String(i + 1)}>
                                Sesi {i + 1}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {expanded && (
                        <>
                          <ul aria-label={`Daftar siswa kelas ${group.classLabel}`} className="divide-y">
                            {visibleGroupStudents.map((row) => {
                              const isChosen = chosen.has(row.studentId);
                              const assigned = assignments.get(row.studentId);
                              const hasValidSession =
                                assigned !== undefined && Number.isInteger(assigned) && assigned >= 1 && assigned <= capacities.length;
                              const studentSelectValue = isChosen && hasValidSession ? String(assigned) : "";

                              return (
                                <li
                                  key={row.studentId}
                                  className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5"
                                >
                                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                                    <input
                                      type="checkbox"
                                      aria-label={`Pilih ${row.studentName} ${row.nisn}`}
                                      checked={isChosen}
                                      disabled={pending || (!row.active && row.sessionNumber === null)}
                                      onChange={(event) => toggleStudent(row, event.target.checked)}
                                      className="mt-0.5 size-4 shrink-0 accent-primary"
                                    />
                                    <span className="min-w-0 break-words text-xs leading-5">
                                      <strong>{row.studentName}</strong> · NISN {row.nisn}
                                      {row.sessionNumber !== null && (
                                        <>
                                          {" "}
                                          · <strong>Sesi {row.sessionNumber} tersimpan</strong>
                                        </>
                                      )}
                                      {!row.active && <span className="text-destructive"> · kelas tidak aktif</span>}
                                    </span>
                                  </label>

                                  <select
                                    aria-label={`Sesi ${row.studentName} ${row.nisn}`}
                                    value={studentSelectValue}
                                    disabled={pending || !isChosen || !row.active}
                                    onChange={(event) => changeStudentSession(row.studentId, event.target.value)}
                                    className={`${selectClass} h-9! w-full text-xs sm:w-36`}
                                  >
                                    {!isChosen ? (
                                      <option value="">Belum dipilih</option>
                                    ) : !hasValidSession ? (
                                      <option value="">Pilih sesi</option>
                                    ) : null}
                                    {capacities.map((_, i) => (
                                      <option key={i} value={String(i + 1)}>
                                        Sesi {i + 1}
                                      </option>
                                    ))}
                                  </select>
                                </li>
                              );
                            })}
                          </ul>
                          {cPages > 1 && (
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-3.5 py-2 text-xs">
                              <span className="text-muted-foreground">
                                Menampilkan {cPage * CLASS_PAGE_SIZE + 1}–
                                {Math.min((cPage + 1) * CLASS_PAGE_SIZE, group.students.length)} dari {group.students.length} siswa
                              </span>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={cPage === 0}
                                  onClick={() => setClassPages((prev) => ({ ...prev, [group.classId]: cPage - 1 }))}
                                >
                                  Sebelumnya
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={cPage + 1 >= cPages}
                                  onClick={() => setClassPages((prev) => ({ ...prev, [group.classId]: cPage + 1 }))}
                                >
                                  Berikutnya
                                </Button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  );
                })}
              </div>
            )}

            {groupPages > 1 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>
                  Halaman kelas {safeGroupPage + 1} dari {groupPages} ({visibleGroups.length} kelas)
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={safeGroupPage === 0}
                    onClick={() => setGroupPage(safeGroupPage - 1)}
                  >
                    Kelas sebelumnya
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={safeGroupPage + 1 >= groupPages}
                    onClick={() => setGroupPage(safeGroupPage + 1)}
                  >
                    Kelas berikutnya
                  </Button>
                </div>
              </div>
            )}

            <Alert className="mt-4 rounded-xl">
              <UsersRound className="size-4" />
              <AlertDescription className="text-xs leading-5">
                Jadwal yang sudah dirilis tidak dipindahkan otomatis. Untuk memindah atau mengeluarkan siswa yang sudah memiliki
                jadwal reguler dirilis, tarik rilis pelaksanaan terkait terlebih dahulu. Siswa baru tidak otomatis masuk saat
                penempatan kelas berubah.
              </AlertDescription>
            </Alert>

            <Button
              type="button"
              className="mt-4 self-start"
              disabled={pending || invalidCapacity || overCapacity || outOfRangeCount > 0}
              onClick={() => setConfirming(true)}
            >
              Simpan pembagian sesi
            </Button>
          </Card>

          {error && (
            <Alert variant="destructive" role="alert" className="rounded-2xl">
              <CircleAlert className="size-4" />
              <AlertTitle>Pembagian belum disimpan</AlertTitle>
              <AlertDescription>
                {error.message}
                {error.reload && (
                  <Button type="button" size="sm" variant="outline" className="mt-3 block" onClick={() => router.refresh()}>
                    Muat ulang
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      {confirming && selected && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !pending) setConfirming(false);
          }}
        >
          <DialogContent
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg"
            showCloseButton={!pending}
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (pending) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>Simpan pembagian sesi?</DialogTitle>
              <DialogDescription>
                Periode <strong className="text-foreground">{selected.name}</strong> · {selectedRows.length} siswa ·{" "}
                {capacities.length} sesi. Daftar yang tersimpan akan diganti sesuai pembagian saat ini; jadwal yang dirilis
                tidak berubah otomatis.
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-1 text-xs">
              {totals.map((total, i) => (
                <li key={i}>
                  Sesi {i + 1}: {total} dari {capacitiesAsNumbers[i]} tempat
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
                Batal
              </Button>
              <Button type="button" disabled={pending} onClick={save}>
                {pending && <Spinner aria-hidden="true" />}
                {pending ? "Menyimpan..." : "Ya, simpan pembagian"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
