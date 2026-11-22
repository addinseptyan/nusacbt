"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, Info } from "lucide-react";

import { resolveFinalGradeOperation, type FinalGradeAction } from "@/app/data-tes/monitoring/final-grade-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { validDataId } from "@/lib/class-validation.mjs";
import { validTokenOperationId } from "@/lib/exam-token-validation.mjs";

const STORAGE_KEY = "nusacbt.final-grade.pending.v1";
const EVENT = "nusacbt-final-grade-pending";
export type PendingFinalGrade = { operationId: string; testId: string; identityId: string | null; operation: FinalGradeAction };

function newId() {
  // getRandomValues juga tersedia pada HTTP LAN; randomUUID memerlukan HTTPS.
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function readPending(): PendingFinalGrade | null {
  const raw = sessionStorage.getItem(STORAGE_KEY); if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("operationId" in value) || !("testId" in value) || !("identityId" in value) || !("operation" in value)) throw new Error("Data permintaan rusak.");
  const operationId = validTokenOperationId(value.operationId); const testId = validDataId(value.testId);
  const identityId = value.identityId === null ? null : validDataId(value.identityId);
  if (!operationId || !testId || (value.operation !== "method" && value.operation !== "finalize" && value.operation !== "reopen") ||
      (value.operation === "method" ? value.identityId !== null : !identityId)) throw new Error("Data permintaan rusak.");
  return { operationId, testId, identityId, operation: value.operation };
}
export function prepareFinalGradeOperation(testId: string, identityId: string | null, operation: FinalGradeAction): PendingFinalGrade | null {
  if (readPending()) { window.dispatchEvent(new Event(EVENT)); return null; }
  const record = { operationId: newId(), testId, identityId, operation };
  const encoded = JSON.stringify(record); sessionStorage.setItem(STORAGE_KEY, encoded);
  if (sessionStorage.getItem(STORAGE_KEY) !== encoded) throw new Error("Penyimpanan sesi gagal.");
  return record;
}
export function forgetFinalGradeOperation(record: PendingFinalGrade) {
  try { if (readPending()?.operationId === record.operationId) sessionStorage.removeItem(STORAGE_KEY); } catch { /* Pemeriksaan ulang tetap aman. */ }
}
export function notifyFinalGradeUncertain() { window.dispatchEvent(new Event(EVENT)); }

export function FinalGradeRecovery() {
  const router = useRouter(); const [record, setRecord] = useState<PendingFinalGrade | null>(null);
  const [storageError, setStorageError] = useState(false); const [pending, startTransition] = useTransition();
  const [error, setError] = useState(""); const [outcome, setOutcome] = useState<"applied" | "cancelled" | null>(null);
  useEffect(() => {
    function load() { try { setRecord(readPending()); setStorageError(false); } catch { setStorageError(true); } }
    const timer = window.setTimeout(load, 0); window.addEventListener(EVENT, load);
    return () => { window.clearTimeout(timer); window.removeEventListener(EVENT, load); };
  }, []);
  function resolve() {
    if (!record || pending || outcome) return;
    const form = new FormData(); form.set("operationId", record.operationId); form.set("testId", record.testId);
    form.set("identityId", record.identityId ?? ""); form.set("operation", record.operation); setError("");
    startTransition(async () => {
      try {
        const result = await resolveFinalGradeOperation(form);
        if (!result.ok) { setError(result.error); return; }
        forgetFinalGradeOperation(record); setOutcome(result.outcome); setRecord(null);
      } catch { setError("Belum dapat mengamankan permintaan. Periksa koneksi dan coba lagi."); }
    });
  }
  return <>
    {storageError && <Alert variant="destructive" role="alert" className="mb-5 max-w-5xl"><CircleAlert className="size-4" /><AlertTitle>Penyimpanan sesi nilai akhir tidak tersedia atau rusak</AlertTitle><AlertDescription>Tindakan nilai akhir dinonaktifkan. Gunakan tab yang sama dan hubungi pengelola jika identitas permintaan hilang.</AlertDescription></Alert>}
    {(record || outcome) && <Dialog open><DialogContent showCloseButton={false} onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()} className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md">
      <DialogHeader><DialogTitle>Hasil tindakan nilai akhir belum pasti</DialogTitle><DialogDescription>Periksa dan amankan sebelum tindakan lain. Jangan tutup tab atau hapus data sesi browser sampai selesai.</DialogDescription></DialogHeader>
      {!outcome ? <p className="text-sm leading-6 text-muted-foreground">Server memeriksa apakah tindakan sempat berhasil. Jika belum, request lama dipagari agar tidak berlaku saat datang terlambat.</p>
        : <Alert role="status"><Info className="size-4" /><AlertTitle>{outcome === "applied" ? "Tindakan sempat berhasil" : "Permintaan diamankan"}</AlertTitle><AlertDescription>{outcome === "applied" ? "Muat ulang untuk memeriksa status terkini; status atau metode mungkin telah berubah lagi." : "Permintaan yang belum berhasil dibatalkan dan tidak dapat mengubah nilai jika datang terlambat."}</AlertDescription></Alert>}
      {error && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>{error} <Link href="/login" className="underline">Masuk kembali di tab ini</Link>.</AlertDescription></Alert>}
      <DialogFooter>{outcome ? <Button type="button" onClick={() => { setOutcome(null); router.refresh(); }}>Tutup dan muat ulang status</Button>
        : <Button type="button" disabled={pending} onClick={resolve}>{pending ? "Memeriksa…" : "Periksa dan amankan"}</Button>}</DialogFooter>
    </DialogContent></Dialog>}
  </>;
}
