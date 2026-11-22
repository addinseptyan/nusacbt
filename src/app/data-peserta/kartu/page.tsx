import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, IdCard } from "lucide-react";

import { CardManager } from "@/app/data-peserta/kartu/card-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdmin } from "@/lib/admin-auth";
import { CardPageSessionExpired, CardPeriodChanged, loadParticipantCardPage } from "@/lib/participant-card-data";
import { parseCardFilters } from "@/lib/participant-card-filter.mjs";
import type { CardPageData } from "@/lib/participant-card-types";
import "./card-print.css";

export const metadata = { title: "Cetak Kartu Peserta — NusaCBT", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
function searchValues(input: Search) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.append(key, value);
  }
  return params;
}

export default async function ParticipantCardsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const parsed = parseCardFilters(searchValues(await searchParams));
  if (!parsed.ok) return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Cetak Kartu Peserta</h1>
    <Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Filter tidak valid</AlertTitle>
      <AlertDescription>{parsed.error} <Link href="/data-peserta/kartu" className="underline">Atur ulang filter</Link>.</AlertDescription></Alert></div>;
  let data: CardPageData;
  try { data = await loadParticipantCardPage(parsed.filters, parsed.page); }
  catch (error) {
    if (error instanceof CardPageSessionExpired) redirect("/login");
    if (error instanceof CardPeriodChanged) return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Cetak Kartu Peserta</h1><Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Periode login berubah</AlertTitle><AlertDescription>Muat ulang untuk memakai periode login aktif. <Link href="/data-peserta/kartu" className="underline">Buka kartu</Link>.</AlertDescription></Alert></div>;
    return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Cetak Kartu Peserta</h1>
      <Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Data kartu belum dapat dimuat</AlertTitle>
        <AlertDescription>Periksa PostgreSQL dan migrasi sampai 024, lalu muat ulang halaman.</AlertDescription></Alert></div>;
  }
  // Data baru tidak boleh mewarisi pilihan lama secara diam-diam.
  const managerKey = JSON.stringify([data.filters, data.page, data.rows.map((row) => row.candidate?.token ?? row.studentId)]);
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
    <div className="mb-6 flex items-start gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><IdCard className="size-5" /></span>
      <div><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data peserta</p>
        <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Cetak Kartu Peserta</h1>
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">Pilih peserta, periksa pratinjau, lalu cetak pada kertas A4 atau simpan sebagai PDF.</p></div>
    </div>
    <CardManager key={managerKey} data={data} />
  </div>;
}
