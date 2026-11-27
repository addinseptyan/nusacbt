import Link from "next/link";
import { CircleAlert, UsersRound } from "lucide-react";

import { AccountManager } from "@/app/data-peserta/akun/account-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { validDataId } from "@/lib/class-validation.mjs";
import { loadAccountPage } from "@/lib/participant-account-service";
import type { AccountPageData } from "@/lib/participant-account-types";

export const metadata = { title: "Akun Peserta" };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ periode?: string | string[] }> }) {
  const { admin, allowed } = await requireAdminAccess("participant_accounts.manage", "participant_passwords.manage");
  if (!allowed) return <AccessDenied section="Data peserta" title="Akun Peserta" />;
  const canManageAccounts = adminHasPermission(admin, "participant_accounts.manage");
  const canManagePasswords = adminHasPermission(admin, "participant_passwords.manage");
  const params = await searchParams;
  const supplied = params.periode !== undefined;
  const periodId = validDataId(params.periode);
  let data: AccountPageData;
  try {
    data = await loadAccountPage(periodId, { defaultToFirst: !supplied });
    if (supplied && !periodId) data.identities.selectionMissing = true;
  } catch {
    return <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
      <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p>
      <h1 className="mt-2 text-[29px] font-bold tracking-tight">Akun Peserta</h1>
      <Alert variant="destructive" className="mt-6 max-w-2xl"><CircleAlert className="size-4" /><AlertTitle>Data akun belum dapat dimuat</AlertTitle><AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru telah diterapkan. <Link href="/data-peserta/siswa" className="underline">Kembali ke data siswa</Link>.</AlertDescription></Alert>
    </div>;
  }
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
    <div className="mb-6 flex items-start gap-3">
      <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><UsersRound className="size-5" /></span>
      <div><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p><h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Akun Peserta</h1><p className="mt-2 text-[13px] leading-6 text-muted-foreground">Kelola identitas, sandi, dan penguncian login dalam satu daftar per periode.</p></div>
    </div>
    <AccountManager
      key={data.identities.selected?.id ?? "none"}
      data={data}
      canManageAccounts={canManageAccounts}
      canManagePasswords={canManagePasswords}
    />
  </div>;
}
