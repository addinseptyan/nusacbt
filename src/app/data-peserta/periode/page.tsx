import { CalendarDays, CircleAlert } from "lucide-react";

import { PeriodManager } from "@/app/data-peserta/periode/period-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdminAccess } from "@/lib/admin-auth";
import type { ExamPeriod } from "@/lib/period-types";
import { getPostgresPool } from "@/lib/postgres";

export const metadata = { title: "Periode Ujian" };
export const dynamic = "force-dynamic";

export default async function PeriodPage() {
  const { allowed } = await requireAdminAccess("periods.manage");
  if (!allowed) return <AccessDenied section="Data peserta" title="Periode Ujian" />;
  let periods: ExamPeriod[]; let activeRevision: string; let activeYearId: string | null; let years: Array<{ id: string; name: string }>;
  try {
    // Baca pengaturan dan daftar dari snapshot yang sama, termasuk saat daftar kosong.
    const result = await getPostgresPool().query<{ activeRevision: string; periods: ExamPeriod[]; activeYearId: string | null; years: Array<{ id: string; name: string }> }>(
      `SELECT settings.xmin::text AS "activeRevision",
        COALESCE((SELECT json_agg(json_build_object(
          'id', e.id::text, 'name', e.name, 'startDate', to_char(e.start_date, 'YYYY-MM-DD'),
          'endDate', CASE WHEN e.end_date IS NULL THEN NULL ELSE to_char(e.end_date, 'YYYY-MM-DD') END,
          'revision', e.xmin::text, 'yearId', e.academic_year_id::text,
          'yearName', (SELECT name FROM academic_years y WHERE y.id=e.academic_year_id),
          'isActive', e.is_active
        ) ORDER BY e.is_active DESC, e.start_date DESC, e.id DESC) FROM exam_periods e), '[]'::json) AS periods,
        ys.active_year_id::text AS "activeYearId",
        COALESCE((SELECT json_agg(json_build_object('id',y.id::text,'name',y.name) ORDER BY y.name DESC,y.id DESC) FROM academic_years y),'[]'::json) AS years
       FROM participant_login_settings settings CROSS JOIN academic_year_settings ys WHERE settings.id = 1 AND ys.id=1`,
    );
    if (result.rowCount !== 1) throw new Error("Pengaturan login peserta tidak tersedia.");
    ({ periods, activeRevision, activeYearId, years } = result.rows[0]);
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
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">Kelola periode ujian di dalam tahun ajaran; beberapa periode pada tahun aktif dapat diaktifkan bersamaan untuk login peserta.</p>
        </div>
      </div>
      <PeriodManager periods={periods} years={years} activeYearId={activeYearId} activeRevision={activeRevision} />
    </div>
  );
}
