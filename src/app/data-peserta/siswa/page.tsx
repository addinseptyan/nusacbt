import { CircleAlert, UsersRound } from "lucide-react";

import { StudentManager } from "@/app/data-peserta/siswa/student-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdmin } from "@/lib/admin-auth";
import { getPostgresPool } from "@/lib/postgres";
import type { PlacementClass, PlacementPeriod, Student, StudentPlacement } from "@/lib/student-types";

export const metadata = { title: "Data Siswa — NusaCBT" };

export default async function StudentsPage() {
  await requireAdmin();
  let students: Student[];
  let periods: PlacementPeriod[];
  let classes: PlacementClass[];
  let placements: StudentPlacement[];
  try {
    const [studentResult, periodResult, classResult, placementResult] = await Promise.all([
      getPostgresPool().query<Student>(
        `SELECT id::text AS id, name, nisn,
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
         FROM school_students ORDER BY lower(name), nisn, id`,
      ),
      getPostgresPool().query<PlacementPeriod>(
        `SELECT id::text AS id, name, to_char(start_date, 'YYYY-MM-DD') AS "startDate"
         FROM exam_periods ORDER BY start_date DESC, id DESC`,
      ),
      getPostgresPool().query<PlacementClass>(
        `SELECT c.id::text AS id, c.level || ' ' || m.name AS label
         FROM school_classes c JOIN school_majors m ON m.id = c.major_id
         ORDER BY c.level, lower(btrim(m.name)), c.id`,
      ),
      getPostgresPool().query<StudentPlacement>(
        `SELECT p.id::text AS id, p.student_id::text AS "studentId", p.period_id::text AS "periodId",
          ep.name AS "periodName", to_char(ep.start_date, 'YYYY-MM-DD') AS "periodStart",
          p.class_id::text AS "classId", p.class_name_snapshot AS "classNameSnapshot",
          to_char(p.started_at AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI') || ' UTC' AS "startedLabel",
          CASE WHEN p.ended_at IS NULL THEN NULL
            ELSE to_char(p.ended_at AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI') || ' UTC' END AS "endedLabel"
         FROM student_class_placements p JOIN exam_periods ep ON ep.id = p.period_id
         ORDER BY ep.start_date DESC, p.started_at DESC, p.id DESC`,
      ),
    ]);
    students = studentResult.rows;
    periods = periodResult.rows;
    classes = classResult.rows;
    placements = placementResult.rows;
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Data Siswa</h1>
        <Alert variant="destructive" className="mt-6 max-w-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Data siswa belum dapat dimuat</AlertTitle>
          <AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru telah dijalankan dengan <code>npm run db:migrate</code>.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex items-start gap-3">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><UsersRound className="size-5" /></span>
        <div>
          <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p>
          <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Data Siswa</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">Kelola siswa dan penempatan kelas pada setiap periode ujian.</p>
        </div>
      </div>
      <StudentManager students={students} periods={periods} classes={classes} placements={placements} />
    </div>
  );
}
