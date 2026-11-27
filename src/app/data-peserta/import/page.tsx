import Link from "next/link";
import { CircleAlert, FileSpreadsheet } from "lucide-react";

import { ImportManager } from "@/app/data-peserta/import/import-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdminAccess } from "@/lib/admin-auth";
import { getPostgresPool } from "@/lib/postgres";
import type { PlacementPeriod } from "@/lib/student-types";

export const metadata = { title: "Import Data Peserta" };

export default async function ImportPage() {
  const { allowed } = await requireAdminAccess("students.manage");
  if (!allowed) return <AccessDenied section="Data peserta" title="Import Data Peserta" />;
  let periods: PlacementPeriod[];
  let classCount: number;
  try {
    const [periodResult, classResult] = await Promise.all([
      getPostgresPool().query<PlacementPeriod>(
        `SELECT id::text AS id,name,''::text AS "startDate" FROM academic_years ORDER BY name DESC,id DESC`,
      ),
      getPostgresPool().query<{ count: string }>("SELECT count(*)::text AS count FROM school_classes"),
    ]);
    periods = periodResult.rows;
    classCount = Number(classResult.rows[0].count);
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Import Data Peserta</h1>
        <Alert variant="destructive" className="mt-6 max-w-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Data belum dapat dimuat</AlertTitle>
          <AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru sudah diterapkan. <Link href="/data-peserta/siswa" className="underline">Kembali ke data siswa</Link>.</AlertDescription>
        </Alert>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex items-start gap-3">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><FileSpreadsheet className="size-5" /></span>
        <div>
          <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p>
          <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Import Data Peserta</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">Periksa file Excel sebelum menambahkan siswa dan penempatannya pada tahun ajaran.</p>
        </div>
      </div>
      <ImportManager periods={periods} classCount={classCount} />
    </div>
  );
}
