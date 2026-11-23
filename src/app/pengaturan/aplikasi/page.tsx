import { CircleAlert, Settings2 } from "lucide-react";

import { AppSettingsManager } from "@/app/pengaturan/aplikasi/app-settings-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdmin } from "@/lib/admin-auth";
import { loadAdminAppSettings } from "@/lib/app-settings-service";
import type { AdminAppSettings } from "@/lib/app-settings-types";

export const metadata = { title: "Pengaturan Aplikasi — NusaCBT" };
export const dynamic = "force-dynamic";

export default async function AppSettingsPage() {
  await requireAdmin();
  let settings: AdminAppSettings;
  try {
    settings = await loadAdminAppSettings();
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Pengaturan</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Pengaturan Aplikasi</h1>
        <Alert variant="destructive" role="alert" className="mt-6 max-w-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Pengaturan aplikasi belum dapat dimuat</AlertTitle>
          <AlertDescription>
            Pastikan PostgreSQL berjalan dan migrasi sampai <code>025_app_settings.sql</code> telah dijalankan dengan{" "}
            <code>npm run db:migrate</code>.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex items-start gap-3">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Settings2 className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Pengaturan</p>
          <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Pengaturan Aplikasi</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
            Atur identitas sekolah, informasi peserta, logo, kop surat, dan palet warna aplikasi.
          </p>
        </div>
      </div>

      <AppSettingsManager key={settings.revision} initialSettings={settings} />
    </div>
  );
}
