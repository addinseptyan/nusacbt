import { CircleAlert, KeyRound, Users } from "lucide-react";
import Link from "next/link";

import { UserManager } from "@/app/pengaturan/user/user-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { loadAdminUsersPageData } from "@/lib/admin-users-service";

export const metadata = { title: "Pengaturan User — NusaCBT" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const { admin, allowed } = await requireAdminAccess("users.manage");
  if (!allowed) {
    return <AccessDenied section="Pengaturan" title="Pengaturan User" />;
  }

  let data;
  try {
    data = await loadAdminUsersPageData();
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Pengaturan</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Pengaturan User</h1>
        <Alert variant="destructive" role="alert" className="mt-6 max-w-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Daftar pengguna belum dapat dimuat</AlertTitle>
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
            <Users className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Pengaturan</p>
            <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Pengaturan User</h1>
            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
              Kelola akun operator, peran hak akses, status aktif, buka penguncian login, dan reset kata sandi.
            </p>
          </div>
        </div>
        {adminHasPermission(admin, "roles.manage") && (
          <Button asChild variant="outline" className="h-9 rounded-xl">
            <Link href="/pengaturan/hak-akses" prefetch={false}>
              <KeyRound className="size-4" /> Atur peran & hak akses
            </Link>
          </Button>
        )}
      </div>

      <UserManager
        currentAdmin={admin}
        users={data.users}
        roles={data.roles}
        auditLogs={data.auditLogs}
      />
    </div>
  );
}
