import { CalendarDays, CircleAlert } from "lucide-react";

import { PeriodManager } from "@/app/data-peserta/periode/period-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdmin } from "@/lib/admin-auth";
import type { ExamPeriod } from "@/lib/period-types";
import { getPostgresPool } from "@/lib/postgres";

export const metadata = { title: "Periode Ujian — NusaCBT" };
export const dynamic = "force-dynamic";

export default async function PeriodPage() {
  await requireAdmin();
  let periods: ExamPeriod[]; let activePeriodId: string | null; let activeRevision: string;
  try {
    // Baca pengaturan dan daftar dari snapshot yang sama, termasuk saat daftar kosong.
    const result = await getPostgresPool().query<{ activePeriodId: string | null; activeRevision: string; periods: ExamPeriod[] }>(
      `SELECT settings.period_id::text AS "activePeriodId", settings.xmin::text AS "activeRevision",
        COALESCE((SELECT json_agg(json_build_object(
          'id', e.id::text, 'name', e.name, 'startDate', to_char(e.start_date, 'YYYY-MM-DD'),
          'endDate', CASE WHEN e.end_date IS NULL THEN NULL ELSE to_char(e.end_date, 'YYYY-MM-DD') END,
          'revision', e.xmin::text
        ) ORDER BY e.start_date DESC, e.id DESC) FROM exam_periods e), '[]'::json) AS periods
       FROM participant_login_settings settings WHERE settings.id = 1`,
    );
    if (result.rowCount !== 1) throw new Error("Pengaturan login peserta tidak tersedia.");
    ({ periods, activePeriodId, activeRevision } = result.rows[0]);
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
      <PeriodManager periods={periods} activePeriodId={activePeriodId} activeRevision={activeRevision} />
    </div>
  );
}
