"use client";

import { CheckCircle2, CircleDashed, Info } from "lucide-react";

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
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10 rounded-xl bg-card px-4 font-semibold"><Info className="size-4" /> Tentang tahap ini</Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Fondasi NusaCBT</DialogTitle>
          <DialogDescription>Pratinjau awal untuk meninjau struktur dan tampilan aplikasi.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1 text-sm">
          <div className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /><span>Login admin, topik/mata pelajaran, soal manual, periode, kelas, siswa, impor Excel, identitas, dan sandi peserta per periode tersedia.</span></div>
          <div className="flex gap-2.5"><CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>Login peserta, impor/ekspor soal, pengerjaan ujian, dan laporan belum aktif.</span></div>
        </div>
        <Alert className="rounded-xl bg-muted/50">
          <Info className="size-4" />
          <AlertTitle>Belum untuk ujian sungguhan</AlertTitle>
          <AlertDescription>Gunakan hanya sebagai pratinjau sampai fitur dan keamanan diuji.</AlertDescription>
        </Alert>
        <DialogFooter>
          <DialogClose asChild><Button className="h-9 rounded-lg">Mengerti</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
