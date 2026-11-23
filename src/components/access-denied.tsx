import { ArrowLeft, ShieldBan } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function AccessDenied({
  section,
  title,
  detail = "Akun Anda tidak memiliki hak akses untuk membuka halaman ini. Hubungi Superadmin apabila izin diperlukan.",
}: {
  section: string;
  title: string;
  detail?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-8 sm:px-7 lg:px-9">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-2 text-[10px] font-bold tracking-[0.15em] text-primary uppercase">{section}</p>
          <h1 className="text-[29px] font-bold tracking-[-0.045em]">{title}</h1>
        </div>
        <Badge variant="destructive" className="h-7 rounded-full px-3 text-[11px]">
          403 · Akses dibatasi
        </Badge>
      </div>

      <Card className="max-w-2xl gap-0 rounded-[20px] p-6 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <ShieldBan className="size-6" />
          </span>
          <div className="min-w-0 flex-1 space-y-3">
            <Alert variant="destructive" role="alert" className="rounded-xl">
              <AlertTitle className="font-bold">Akses halaman dibatasi</AlertTitle>
              <AlertDescription>{detail}</AlertDescription>
            </Alert>
            <Button asChild variant="outline" className="h-9 rounded-xl">
              <Link href="/" prefetch={false}>
                <ArrowLeft className="size-4" /> Kembali ke dashboard
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
