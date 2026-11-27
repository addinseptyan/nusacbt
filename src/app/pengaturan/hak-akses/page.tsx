import { CircleAlert, KeyRound, Users } from "lucide-react";
import Link from "next/link";

import { RoleManager } from "@/app/pengaturan/hak-akses/role-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { loadAdminRolesPageData } from "@/lib/admin-users-service";

export const metadata = { title: "Pengaturan Hak Akses" };
export const dynamic = "force-dynamic";

export default async function AdminRolesPage() {
  const { admin, allowed } = await requireAdminAccess("roles.manage");
  if (!allowed) {
    return <AccessDenied section="Pengaturan" title="Pengaturan Hak Akses" />;
  }

  let data;
  try {
    data = await loadAdminRolesPageData();
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Pengaturan</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Pengaturan Hak Akses</h1>
        <Alert variant="destructive" role="alert" className="mt-6 max-w-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Daftar peran belum dapat dimuat</AlertTitle>
          <AlertDescription>
            Pastikan PostgreSQL berjalan dan migrasi <code>026_admin_users_rbac.sql</code> telah diterapkan.
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
            <KeyRound className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Pengaturan</p>
            <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Pengaturan Hak Akses</h1>
            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
              Kelola peran dan matriks 21 izin granular untuk membatasi akses modul serta tindakan sensitif.
            </p>
          </div>
        </div>
        {adminHasPermission(admin, "users.manage") && (
          <Button asChild variant="outline" className="h-9 rounded-xl">
            <Link href="/pengaturan/user" prefetch={false}>
              <Users className="size-4" /> Kelola user panel
            </Link>
          </Button>
        )}
      </div>

      <RoleManager currentAdmin={admin} roles={data.roles} />
    </div>
  );
}
