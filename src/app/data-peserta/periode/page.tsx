import { CalendarDays, CircleAlert } from "lucide-react";

import { PeriodManager } from "@/app/data-peserta/periode/period-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdmin } from "@/lib/admin-auth";
import type { ExamPeriod } from "@/lib/period-types";
import { getPostgresPool } from "@/lib/postgres";

export const metadata = { title: "Periode Ujian — NusaCBT" };

export default async function PeriodPage() {
  await requireAdmin();
  let periods: ExamPeriod[];
  try {
    const result = await getPostgresPool().query<ExamPeriod>(
      `SELECT id::text AS id, name,
        to_char(start_date, 'YYYY-MM-DD') AS "startDate",
        CASE WHEN end_date IS NULL THEN NULL ELSE to_char(end_date, 'YYYY-MM-DD') END AS "endDate"
       FROM exam_periods ORDER BY start_date DESC, id DESC`,
    );
    periods = result.rows;
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Periode Ujian</h1>
        <Alert variant="destructive" className="mt-6 max-w-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Data periode belum dapat dimuat</AlertTitle>
          <AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru telah dijalankan dengan <code>npm run db:migrate</code>.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex items-start gap-3">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><CalendarDays className="size-5" /></span>
        <div>
          <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p>
          <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Periode Ujian</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">Kelola periode sebagai dasar pengelolaan peserta dan ujian.</p>
        </div>
      </div>
      <PeriodManager periods={periods} />
    </div>
  );
}
