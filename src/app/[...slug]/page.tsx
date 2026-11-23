import type { Metadata } from "next";
import { ArrowDownToLine, ArrowLeft, Construction, Info } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin-auth";
import { adminHasAnyPermission } from "@/lib/admin-permissions.mjs";
import { findNavigationPage } from "@/lib/navigation";

type PageProps = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = findNavigationPage(`/${slug.join("/")}`);
  return { title: page ? `${page.title} — NusaCBT` : "Halaman tidak ditemukan — NusaCBT" };
}

export default async function ModulePage({ params }: PageProps) {
  const admin = await requireAdmin();
  const { slug } = await params;
  const page = findNavigationPage(`/${slug.join("/")}`);
  if (!page) notFound();
  if (page.permissions && !adminHasAnyPermission(admin, page.permissions)) {
    return <AccessDenied section={page.section} title={page.title} />;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-8 sm:px-7 lg:px-9">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-2 text-[10px] font-bold tracking-[0.15em] text-primary uppercase">{page.section}</p>
          <h1 className="text-[29px] font-bold tracking-[-0.045em]">{page.title}</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted-foreground">{page.description}</p>
        </div>
        <Badge variant="outline" className="h-7 rounded-full bg-card px-3 text-[11px] text-muted-foreground">Dalam pengembangan</Badge>
      </div>

      <Alert className="mb-5 rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] px-4 py-3 text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200">
        <Info className="size-4 text-[#727fc8] dark:text-indigo-300" />
        <AlertTitle className="text-[12px] font-bold">Fitur ini belum aktif</AlertTitle>
        <AlertDescription className="mt-0.5 text-[12px] text-[#6873a0] dark:text-indigo-200/70">Halaman ini adalah bagian dari fondasi navigasi, bukan fitur yang sudah terhubung ke database.</AlertDescription>
      </Alert>

      {page.template ? (
        <Card className="max-w-2xl gap-0 rounded-[18px] p-6 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
          <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"><ArrowDownToLine className="size-5" /></span>
          <h2 className="mt-4 text-[16px] font-bold">Template contoh</h2>
          <p className="mt-2 text-[12px] leading-6 text-muted-foreground">{page.template.detail} Template dibuat berdasarkan referensi PDF dan memakai data fiktif. Silakan tinjau sebelum digunakan sebagai format impor.</p>
          <Button asChild className="mt-5 h-10 w-fit rounded-xl px-4 font-semibold"><a href={page.template.href} download><ArrowDownToLine className="size-4" /> {page.template.label}</a></Button>
        </Card>
      ) : (
        <Card className="max-w-2xl items-center gap-0 rounded-[18px] px-6 py-12 text-center ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"><Construction className="size-6" /></span>
          <h2 className="mt-4 text-[16px] font-bold">Halaman sedang disiapkan</h2>
          <p className="mt-2 max-w-sm text-[12px] leading-6 text-muted-foreground">Fungsi {page.title.toLowerCase()} akan dikembangkan dan diuji pada tahap berikutnya.</p>
          <Button asChild variant="outline" className="mt-5 h-9 rounded-xl"><Link href="/"><ArrowLeft className="size-4" /> Kembali ke dashboard</Link></Button>
        </Card>
      )}
    </div>
  );
}
