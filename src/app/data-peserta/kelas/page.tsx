import { CircleAlert, GraduationCap } from "lucide-react";

import { ClassManager } from "@/app/data-peserta/kelas/class-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdmin } from "@/lib/admin-auth";
import type { SchoolClass, SchoolMajor } from "@/lib/class-types";
import { getPostgresPool } from "@/lib/postgres";

export const metadata = { title: "Kelas / Jurusan — NusaCBT" };

export default async function ClassesPage() {
  await requireAdmin();
  let classes: SchoolClass[];
  let majors: SchoolMajor[];
  try {
    const [classResult, majorResult] = await Promise.all([
      getPostgresPool().query<SchoolClass>(
        `SELECT c.id::text AS id, c.level, m.id::text AS "majorId", m.name AS "majorName"
         FROM school_classes c JOIN school_majors m ON m.id = c.major_id
         ORDER BY c.level, lower(btrim(m.name)), c.id`,
      ),
      getPostgresPool().query<SchoolMajor>("SELECT id::text AS id, name FROM school_majors ORDER BY lower(btrim(name)), name, id"),
    ]);
    classes = classResult.rows;
    majors = majorResult.rows;
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Kelas / Jurusan</h1>
        <Alert variant="destructive" className="mt-6 max-w-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Data kelas dan jurusan belum dapat dimuat</AlertTitle>
          <AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru telah dijalankan dengan <code>npm run db:migrate</code>.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex items-start gap-3">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><GraduationCap className="size-5" /></span>
        <div>
          <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p>
          <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Kelas / Jurusan</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">Kelola jurusan dan kelas untuk berbagai periode ujian.</p>
        </div>
      </div>
      <ClassManager classes={classes} majors={majors} />
    </div>
  );
}
