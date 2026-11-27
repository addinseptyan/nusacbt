import { CircleAlert, UsersRound } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdminAccess } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";
import type { Student } from "@/lib/student-types";
import { YearStudentManager, type YearEnrollment } from "./year-student-manager";

export const metadata = { title: "Data Siswa" };
export const dynamic = "force-dynamic";

type Search = { tahun?: string | string[] };
export default async function StudentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { allowed } = await requireAdminAccess("students.manage");
  if (!allowed) return <AccessDenied section="Data peserta" title="Data Siswa" />;
  let years: Array<{ id: string; name: string }>; let activeYearId: string | null; let selectedYearId: string | null;
  let classes: Array<{ id: string; label: string }>; let students: Student[]; let enrollments: YearEnrollment[];
  try {
    const input = (await searchParams).tahun;
    if (input !== undefined && !validDataId(input)) throw new Error("Tahun tidak valid.");
    const pool = getPostgresPool();
    const [ys, setting, cs, ss] = await Promise.all([
      pool.query<{ id: string; name: string }>("SELECT id::text AS id,name FROM academic_years ORDER BY name DESC,id DESC"),
      pool.query<{ id: string | null }>('SELECT active_year_id::text AS id FROM academic_year_settings WHERE id=1'),
      pool.query<{ id: string; label: string }>("SELECT c.id::text AS id,c.level || ' ' || m.name AS label FROM school_classes c JOIN school_majors m ON m.id=c.major_id ORDER BY c.level,lower(m.name),c.id"),
      pool.query<Student>(`SELECT id::text AS id,name,nisn,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version FROM school_students ORDER BY lower(name),nisn,id`),
    ]);
    years = ys.rows; activeYearId = setting.rows[0]?.id ?? null; classes = cs.rows; students = ss.rows;
    selectedYearId = typeof input === "string" ? input : activeYearId;
    if (selectedYearId && !years.some((y) => y.id === selectedYearId)) throw new Error("Tahun tidak ditemukan.");
    enrollments = selectedYearId ? (await pool.query<YearEnrollment>(
      `SELECT e.id::text AS id,e.student_id::text AS "studentId",e.class_id::text AS "classId",e.class_name_snapshot AS "className",
        e.status,e.transition,e.xmin::text AS revision,s.name,s.nisn,
        to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "studentVersion"
       FROM academic_year_enrollments e JOIN school_students s ON s.id=e.student_id
       WHERE e.academic_year_id=$1::bigint ORDER BY lower(s.name),s.nisn,s.id`, [selectedYearId],
    )).rows : [];
  } catch {
    return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Data Siswa</h1><Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Data siswa belum dapat dimuat</AlertTitle><AlertDescription>Periksa tahun ajaran, PostgreSQL dan migrasi terbaru.</AlertDescription></Alert></div>;
  }
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9"><div className="mb-6 flex items-start gap-3"><span className="flex size-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><UsersRound className="size-5" /></span><div><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p><h1 className="mt-1 text-[26px] font-bold tracking-tight sm:text-[30px]">Data Siswa</h1><p className="mt-2 text-[13px] text-muted-foreground">Kelola siswa dan kelas berdasarkan tahun ajaran.</p></div></div>
    <YearStudentManager years={years} selectedYearId={selectedYearId} activeYearId={activeYearId} classes={classes} students={students} enrollments={enrollments} />
  </div>;
}
