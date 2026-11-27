import { CircleAlert, DatabaseBackup, UploadCloud } from "lucide-react";
import Link from "next/link";

import { RestoreManager } from "@/app/tool/pemulihan/restore-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireAdminAccess } from "@/lib/admin-auth";
import { loadToolDashboardData } from "@/lib/database-backup-service";

export const metadata = { title: "Upload Database" };
export const dynamic = "force-dynamic";

export default async function RestoreDatabasePage() {
  const { allowed } = await requireAdminAccess("tools.manage");
  if (!allowed) {
    return <AccessDenied section="Tool" title="Upload Database" />;
  }

  let data;
  try {
    data = await loadToolDashboardData();
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Tool</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Upload Database</h1>
        <Alert variant="destructive" role="alert" className="mt-6 max-w-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Halaman pemulihan belum dapat dimuat</AlertTitle>
          <AlertDescription>
            Pastikan PostgreSQL berjalan dan migrasi <code>027_database_backup_audit.sql</code> telah diterapkan.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <UploadCloud className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Tool</p>
            <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">
              Upload Database
            </h1>
            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
              Periksa pratinjau arsip cadangan NusaCBT (.zip) dan pulihkan seluruh data sekolah secara atomik di luar jam ujian aktif.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" className="h-9 rounded-xl">
          <Link href="/tool/backup" prefetch={false}>
            <DatabaseBackup className="size-4" /> Backup Database
          </Link>
        </Button>
      </div>

      <RestoreManager data={data} />
    </div>
  );
}
