import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarRange, CircleAlert } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { loadSessionPlan, ScheduleSessionExpired } from "@/lib/exam-session-service";
import type { SessionPlanPage as SessionPlanData } from "@/lib/exam-session-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SessionPlanManager } from "./session-plan-manager";

export const metadata = { title: "Kelompok Sesi — NusaCBT", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SessionPlanPage({ searchParams }: { searchParams: Promise<{ periode?: string | string[] }> }) {
  await requireAdmin();
  const params = await searchParams; const periodId = validDataId(params.periode);
  let data: SessionPlanData;
  try {
    data = await loadSessionPlan(periodId);
    if (params.periode !== undefined && !periodId) data.selectionMissing = true;
  } catch (error) {
    if (error instanceof ScheduleSessionExpired) redirect("/login");
    return <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9"><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-2 text-[29px] font-bold">Kelompok Sesi</h1><Alert variant="destructive" role="alert" className="mt-6 max-w-2xl"><CircleAlert className="size-4" /><AlertTitle>Kelompok sesi belum dapat dimuat</AlertTitle><AlertDescription>Pastikan database berjalan dan migrasi terbaru sudah diterapkan. <Link href="/data-tes/daftar" className="underline">Kembali ke Daftar Tes</Link>.</AlertDescription></Alert></div>;
  }
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
    <div className="mb-6 flex items-start gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><CalendarRange className="size-5" /></span><div><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Kelompok Sesi</h1><p className="mt-2 text-[13px] leading-6 text-muted-foreground">Bagi siswa satu kali per periode dan gunakan kelompok yang sama untuk tes reguler.</p></div></div>
    <SessionPlanManager key={`${data.selected?.id ?? "none"}-${data.revision ?? "new"}`} data={data} />
  </div>;
}
