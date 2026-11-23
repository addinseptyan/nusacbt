import { CircleAlert, DatabaseBackup, UploadCloud } from "lucide-react";
import Link from "next/link";

import { BackupManager } from "@/app/tool/backup/backup-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireAdminAccess } from "@/lib/admin-auth";
import { loadToolDashboardData } from "@/lib/database-backup-service";

export const metadata = { title: "Backup Database — NusaCBT" };
export const dynamic = "force-dynamic";

export default async function BackupDatabasePage() {
  const { allowed } = await requireAdminAccess("tools.manage");
  if (!allowed) {
    return <AccessDenied section="Tool" title="Backup Database" />;
  }

  let data;
  try {
    data = await loadToolDashboardData();
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Tool</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Backup Database</h1>
        <Alert variant="destructive" role="alert" className="mt-6 max-w-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Informasi backup belum dapat dimuat</AlertTitle>
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
            <DatabaseBackup className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Tool</p>
            <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">
              Backup Database
            </h1>
            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
              Unduh cadangan penuh database dan seluruh berkas gambar terverifikasi sebelum pembaruan atau pergantian server.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" className="h-9 rounded-xl">
          <Link href="/tool/pemulihan" prefetch={false}>
            <UploadCloud className="size-4" /> Upload / Pemulihan Database
          </Link>
        </Button>
      </div>

      <BackupManager data={data} />
    </div>
  );
}
