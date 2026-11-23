import Link from "next/link";
import { CircleAlert, IdCard } from "lucide-react";

import { IdentityManager } from "@/app/data-peserta/identitas/identity-manager";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdminAccess } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { loadIdentityPage } from "@/lib/participant-identity-service";
import type { IdentityPageData } from "@/lib/participant-identity-types";

export const metadata = { title: "Identitas Peserta — NusaCBT" };

export default async function IdentityPage({ searchParams }: { searchParams: Promise<{ periode?: string | string[] }> }) {
  const { allowed } = await requireAdminAccess("participant_accounts.manage");
  if (!allowed) return <AccessDenied section="Data peserta" title="Identitas Peserta" />;
  const params = await searchParams;
  const supplied = params.periode !== undefined;
  const periodId = validDataId(params.periode);
  let data: IdentityPageData;
  try {
    data = await loadIdentityPage(periodId);
    if (supplied && !periodId) data.selectionMissing = true;
  } catch {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9">
        <p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p>
        <h1 className="mt-2 text-[29px] font-bold tracking-tight">Identitas Peserta</h1>
        <Alert variant="destructive" className="mt-6 max-w-2xl"><CircleAlert className="size-4" /><AlertTitle>Data belum dapat dimuat</AlertTitle><AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru telah diterapkan. <Link href="/data-peserta/siswa" className="underline">Kembali ke data siswa</Link>.</AlertDescription></Alert>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
      <div className="mb-6 flex items-start gap-3">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><IdCard className="size-5" /></span>
        <div><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p><h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Identitas Peserta</h1><p className="mt-2 text-[13px] leading-6 text-muted-foreground">Atur nomor peserta dan username untuk satu periode.</p></div>
      </div>
      <IdentityManager key={data.selected?.id ?? "none"} data={data} />
    </div>
  );
}
