"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Info, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { changeRetakePermission } from "@/app/data-tes/monitoring/actions";
import { forgetRetakeOperation, notifyRetakeUncertain, prepareRetakeOperation, type PendingRetake } from "@/app/data-tes/monitoring/retake-recovery";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

type Props = {
  attemptId: string; expectedPermissionId: string | null; expectedFinalRevision: string; mode: "grant" | "revoke";
  student: string; number: string; className: string; period: string; testName: string; label: string;
  attemptNumber: number; deadline: string; zone: string;
};

export function RetakeControl(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition(); const submitting = useRef(false);
  const hydrated = useSyncExternalStore(subscribe, clientReady, serverReady);
  const isGrant = props.mode === "grant";
  function changeOpen(next: boolean) { if (!pending) { setOpen(next); setError(""); } }
  function confirm() {
    if (submitting.current) return;
    let record: PendingRetake | null;
    try {
      record = prepareRetakeOperation(props.attemptId, props.mode);
      if (!record) { setOpen(false); return; }
    } catch {
      setError("Penyimpanan sesi browser tidak tersedia atau identitas permintaan rusak. Jangan mengubah izin; hubungi pengelola."); return;
    }
    const form = new FormData();
    form.set("operation", props.mode); form.set("operationId", record.operationId); form.set("attemptId", props.attemptId);
    form.set("expectedPermissionId", props.expectedPermissionId ?? ""); form.set("expectedFinalRevision", props.expectedFinalRevision);
    setError(""); submitting.current = true;
    startTransition(async () => {
      try {
        const result = await changeRetakePermission(form);
        if (!result.ok) {
          if (result.uncertain) { setOpen(false); notifyRetakeUncertain(); return; }
          forgetRetakeOperation(record); setError(result.error); return;
        }
        forgetRetakeOperation(record); setOpen(false); toast.success(result.message); router.refresh();
      } catch { setOpen(false); notifyRetakeUncertain(); }
      finally { submitting.current = false; }
    });
  }
  return <>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button type="button" variant="outline" size="sm" className="mt-2 h-auto min-h-7 max-w-full rounded-lg whitespace-normal" disabled={!hydrated || pending}
        aria-label={`${isGrant ? "Berikan izin ulang" : "Cabut izin ulang"} ${props.student} ${props.number}`}>
        {isGrant ? <RotateCcw className="size-3.5" /> : <XCircle className="size-3.5" />}{isGrant ? "Berikan izin ulang" : "Cabut izin"}
      </Button></DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg" showCloseButton={!pending}
        onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{isGrant ? "Berikan izin mengulang?" : "Cabut izin mengulang?"}</DialogTitle>
          <DialogDescription>Periksa peserta dan pelaksanaan sebelum melanjutkan.</DialogDescription></DialogHeader>
        <dl className="grid gap-2 rounded-xl border bg-muted/30 p-4 text-sm">
          <div><dt className="text-xs text-muted-foreground">Peserta</dt><dd className="break-words font-semibold">{props.student} · {props.number} · {props.className}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Tes dan periode</dt><dd className="break-words font-semibold">{props.testName} · {props.label} · {props.period}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Pengerjaan terakhir</dt><dd>Ke-{props.attemptNumber} · batas {props.deadline} {props.zone}</dd></div>
        </dl>
        <Alert role="note"><Info className="size-4" /><AlertTitle>{isGrant ? "Satu izin untuk satu pengulangan" : "Hanya izin yang belum digunakan"}</AlertTitle>
          <AlertDescription className="text-xs leading-5">{isGrant
            ? "Peserta harus memasukkan token yang masih berlaku. Soal dan urutan sama, jawaban baru dimulai kosong. Pengerjaan dan nilai sebelumnya tetap tersimpan; batas akhir tidak diperpanjang. Pengumpulan tetap mengikuti pengaturan global."
            : "Peserta tidak dapat menggunakan izin ini setelah dicabut. Jika peserta sudah mulai, pencabutan ditolak dan pengerjaan baru tetap berjalan."}</AlertDescription></Alert>
        {error && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          {error && <Button type="button" variant="outline" disabled={pending} onClick={() => { setOpen(false); router.refresh(); }}>Muat ulang daftar</Button>}
          <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>Batal</Button>
          <Button type="button" disabled={pending} onClick={confirm}>{pending ? "Memproses…" : isGrant ? "Ya, berikan izin" : "Ya, cabut izin"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <noscript><span className="block text-xs text-muted-foreground">Tindakan izin memerlukan JavaScript.</span></noscript>
  </>;
}
