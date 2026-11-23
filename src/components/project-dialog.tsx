"use client";

import { CheckCircle2, CircleDashed, Info } from "lucide-react";

import { useBranding } from "@/components/branding-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ProjectDialog() {
  const branding = useBranding();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10 rounded-xl bg-card px-4 font-semibold"><Info className="size-4" /> Info sistem</Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Tentang {branding.appName}</DialogTitle>
          <DialogDescription>{branding.schoolName || branding.appDescription || "Platform ujian berbasis jaringan lokal untuk sekolah."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1 text-sm">
          <div className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /><span>Tahun ajaran, periode, kelas, siswa, akun, kartu A4, bank soal, impor/ekspor Word, jadwal, token, pengerjaan, monitoring, nilai akhir, rekap Excel, dan identitas aplikasi aktif.</span></div>
          <div className="flex gap-2.5"><CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>Pengaturan pengguna/hak akses granular dan backup/pemulihan melalui antarmuka akan melengkapi tahap berikutnya.</span></div>
        </div>
        <Alert className="rounded-xl bg-muted/50">
          <Info className="size-4" />
          <AlertTitle>Operasional aman</AlertTitle>
          <AlertDescription>Pastikan cadangan database dan kedua file kunci tersimpan terpisah sebelum memakai data sekolah nyata.</AlertDescription>
        </Alert>
        <DialogFooter>
          <DialogClose asChild><Button className="h-9 rounded-lg">Mengerti</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
