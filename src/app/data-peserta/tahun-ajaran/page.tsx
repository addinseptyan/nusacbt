import { CalendarRange, CircleAlert } from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdminAccess } from "@/lib/admin-auth";
import { getPostgresPool } from "@/lib/postgres";
import { AcademicYearManager, type YearItem } from "./year-manager";

export const metadata = { title: "Tahun Ajaran", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AcademicYearsPage() {
  const { allowed } = await requireAdminAccess("academic_years.manage");
  if (!allowed) return <AccessDenied section="Data peserta" title="Tahun Ajaran" />;
  let years: YearItem[]; let activeYearId: string | null; let revision: string;
  try {
    const result = await getPostgresPool().query<{ years: YearItem[]; activeYearId: string | null; revision: string }>(
      `SELECT s.active_year_id::text AS "activeYearId",s.revision::text AS revision,
       COALESCE((SELECT json_agg(json_build_object('id',y.id::text,'name',y.name,
         'students',(SELECT count(*)::int FROM academic_year_enrollments e WHERE e.academic_year_id=y.id AND e.status='active'),
         'periods',(SELECT count(*)::int FROM exam_periods ep WHERE ep.academic_year_id=y.id)) ORDER BY y.name DESC,y.id DESC)
         FROM academic_years y),'[]'::json) AS years FROM academic_year_settings s WHERE s.id=1`,
    );
    if (result.rowCount !== 1) throw new Error("Pengaturan tahun ajaran tidak tersedia.");
    ({ years, activeYearId, revision } = result.rows[0]);
  } catch {
    return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Tahun Ajaran</h1><Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Data belum dapat dimuat</AlertTitle><AlertDescription>Periksa PostgreSQL dan terapkan migrasi terbaru.</AlertDescription></Alert></div>;
  }
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
    <div className="mb-6 flex items-start gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><CalendarRange className="size-5" /></span>
      <div><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p><h1 className="mt-1 text-[26px] font-bold tracking-tight sm:text-[30px]">Tahun Ajaran</h1><p className="mt-2 text-[13px] text-muted-foreground">Kelola tahun aktif dan perpindahan siswa tanpa menghapus riwayat.</p></div></div>
    <AcademicYearManager years={years} activeYearId={activeYearId} revision={revision} />
  </div>;
}
