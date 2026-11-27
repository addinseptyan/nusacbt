"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Info } from "lucide-react";
import { toast } from "sonner";

import { changeFinalGrade, type FinalGradeAction } from "@/app/data-tes/monitoring/final-grade-actions";
import { forgetFinalGradeOperation, notifyFinalGradeUncertain, prepareFinalGradeOperation, type PendingFinalGrade } from "@/app/data-tes/monitoring/final-grade-recovery";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { FinalGradeMethod } from "@/lib/exam-final-grade.mjs";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

type Props = {
  mode: FinalGradeAction; testId: string; testName: string; period: string; method: FinalGradeMethod; methodRevision: string;
  identityId?: string; student?: string; number?: string; className?: string; stateRevision?: string;
  digest?: string; score?: string | null; finished?: number; unfinished?: number; pendingPermissions?: number;
};
export function FinalGradeControl(props: Props) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [error, setError] = useState("");
  const [pending, startTransition] = useTransition(); const submitting = useRef(false);
  const hydrated = useSyncExternalStore(subscribe, clientReady, serverReady);
  const methodChange = props.mode === "method"; const finalizing = props.mode === "finalize";
  const nextMethod = props.method === "highest" ? "average" : "highest";
  const methodName = (method: FinalGradeMethod) => method === "highest" ? "Tertinggi" : "Rata-rata";
  function changeOpen(next: boolean) { if (!pending) { setOpen(next); setError(""); } }
  function confirm() {
    if (submitting.current) return;
    let record: PendingFinalGrade | null;
    try {
      record = prepareFinalGradeOperation(props.testId, props.identityId ?? null, props.mode);
      if (!record) { setOpen(false); return; }
    } catch { setError("Penyimpanan sesi browser tidak tersedia atau identitas permintaan rusak. Jangan mengubah nilai; hubungi pengelola."); return; }
    const form = new FormData();
    form.set("operation", props.mode); form.set("operationId", record.operationId); form.set("testId", props.testId);
    form.set("identityId", props.identityId ?? ""); form.set("expectedRevision", methodChange ? props.methodRevision : props.stateRevision ?? "");
    form.set("expectedMethodRevision", props.methodRevision); form.set("expectedDigest", methodChange ? "" : props.digest ?? "");
    form.set("targetMethod", methodChange ? nextMethod : ""); setError(""); submitting.current = true;
    startTransition(async () => {
      try {
        const result = await changeFinalGrade(form);
        if (!result.ok) {
          if (result.uncertain) { setOpen(false); notifyFinalGradeUncertain(); return; }
          forgetFinalGradeOperation(record); setError(result.error); return;
        }
        forgetFinalGradeOperation(record); setOpen(false); toast.success(result.message); router.refresh();
      } catch { setOpen(false); notifyFinalGradeUncertain(); }
      finally { submitting.current = false; }
    });
  }
  const title = methodChange ? "Ubah metode nilai akhir?" : finalizing ? "Tetapkan nilai akhir?" : "Buka kembali nilai akhir?";
  const button = methodChange ? "Ubah metode" : finalizing ? "Tetapkan nilai akhir" : "Buka kembali";
  const disabled = !hydrated || pending || (finalizing && (!props.finished || !!props.unfinished || props.score === null));
  return <>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button type="button" variant="outline" size="sm" className="rounded-lg" disabled={disabled}
        aria-label={methodChange ? `Ubah metode nilai akhir ${props.testName}` : `${button} ${props.student} ${props.number}`}>{button}</Button></DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg" showCloseButton={!pending}
        onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Periksa tes dan dampak tindakan sebelum melanjutkan.</DialogDescription></DialogHeader>
        <dl className="grid gap-2 rounded-xl border bg-muted/30 p-4 text-sm">
          <div><dt className="text-xs text-muted-foreground">Tes dan periode</dt><dd className="break-words font-semibold">{props.testName} · {props.period}</dd></div>
          {!methodChange && <div><dt className="text-xs text-muted-foreground">Peserta</dt><dd className="break-words font-semibold">{props.student} · {props.number} · {props.className}</dd></div>}
          <div><dt className="text-xs text-muted-foreground">Metode</dt><dd>{methodChange ? `${methodName(props.method)} → ${methodName(nextMethod)}` : methodName(props.method)}</dd></div>
          {!methodChange && <div><dt className="text-xs text-muted-foreground">Nilai dari {props.finished} pengerjaan selesai</dt><dd className="font-semibold tabular-nums">{props.score ?? "—"}</dd></div>}
        </dl>
        <Alert role="note"><Info className="size-4" /><AlertTitle>{methodChange ? "Semua peserta pada tes ini terdampak" : finalizing ? "Kesempatan mulai baru ditutup" : "Nilai menjadi sementara"}</AlertTitle>
          <AlertDescription className="text-xs leading-5">{methodChange
            ? "Nilai akhir yang sudah ditetapkan dihitung ulang dengan metode baru, termasuk yang sudah dibagikan kepada peserta. Perubahan dicatat."
            : finalizing
              ? `Semua pengerjaan selesai Reguler, Susulan dan Remidi dihitung. Tidak boleh ada pengerjaan yang belum selesai. Semua izin ulang yang belum digunakan dicabut (${props.pendingPermissions ?? 0} saat daftar dimuat); izin baru dan mulai pada pelaksanaan lain juga ditutup sampai dibuka kembali.`
              : "Nilai akhir tidak lagi dibagikan dan kesempatan mulai baru terbuka sesuai jadwal, token, dan izin. Izin yang telah dicabut tidak dipulihkan otomatis; berikan izin baru jika diperlukan. Nilai per pengerjaan tetap tersimpan."}</AlertDescription></Alert>
        {error && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          {error && <Button type="button" variant="outline" disabled={pending} onClick={() => { setOpen(false); router.refresh(); }}>Muat ulang daftar</Button>}
          <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>Batal</Button>
          <Button type="button" disabled={pending} onClick={confirm}>{pending && <Spinner aria-hidden="true" />}{pending ? "Memproses…" : methodChange ? "Ya, ubah metode" : finalizing ? "Ya, tetapkan nilai" : "Ya, buka kembali"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <noscript><span className="block text-xs text-muted-foreground">Tindakan nilai akhir memerlukan JavaScript.</span></noscript>
  </>;
}
