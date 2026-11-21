"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, Info } from "lucide-react";

import { resolveRetakeOperation } from "@/app/data-tes/monitoring/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { validDataId } from "@/lib/class-validation.mjs";
import { validTokenOperationId } from "@/lib/exam-token-validation.mjs";

const STORAGE_KEY = "nusacbt.retake.pending.v1";
const EVENT = "nusacbt-retake-pending";
export type PendingRetake = { operationId: string; attemptId: string; operation: "grant" | "revoke" };

function newOperationId() {
  // getRandomValues juga tersedia pada HTTP LAN; randomUUID memerlukan HTTPS.
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function readPending(): PendingRetake | null {
  const raw = sessionStorage.getItem(STORAGE_KEY); if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("operationId" in value) || !("attemptId" in value) || !("operation" in value)) throw new Error("Data permintaan rusak.");
  const operationId = validTokenOperationId(value.operationId); const attemptId = validDataId(value.attemptId);
  if (!operationId || !attemptId || (value.operation !== "grant" && value.operation !== "revoke")) throw new Error("Data permintaan rusak.");
  return { operationId, attemptId, operation: value.operation };
}
export function prepareRetakeOperation(attemptId: string, operation: "grant" | "revoke"): PendingRetake | null {
  if (readPending()) { window.dispatchEvent(new Event(EVENT)); return null; }
  const record = { operationId: newOperationId(), attemptId, operation };
  const encoded = JSON.stringify(record); sessionStorage.setItem(STORAGE_KEY, encoded);
  if (sessionStorage.getItem(STORAGE_KEY) !== encoded) throw new Error("Penyimpanan sesi gagal.");
  return record;
}
export function forgetRetakeOperation(record: PendingRetake) {
  try { if (readPending()?.operationId === record.operationId) sessionStorage.removeItem(STORAGE_KEY); } catch { /* Pemeriksaan ulang tetap aman. */ }
}
export function notifyRetakeUncertain() { window.dispatchEvent(new Event(EVENT)); }

/** Satu dialog pemulihan per tab, juga muncul kembali setelah halaman dimuat ulang. */
export function RetakeRecovery() {
  const router = useRouter(); const [record, setRecord] = useState<PendingRetake | null>(null);
  const [storageError, setStorageError] = useState(false); const [pending, startTransition] = useTransition();
  const [error, setError] = useState(""); const [outcome, setOutcome] = useState<{ result: "applied" | "cancelled"; permissionId: string | null; action: "grant" | "revoke" } | null>(null);
  useEffect(() => {
    function load() {
      try { setRecord(readPending()); setStorageError(false); }
      catch { setStorageError(true); }
    }
    const timer = window.setTimeout(load, 0); window.addEventListener(EVENT, load);
    return () => { window.clearTimeout(timer); window.removeEventListener(EVENT, load); };
  }, []);
  function resolve() {
    if (!record || pending || outcome) return;
    const form = new FormData(); form.set("operationId", record.operationId); form.set("attemptId", record.attemptId); form.set("operation", record.operation);
    setError(""); startTransition(async () => {
      try {
        const result = await resolveRetakeOperation(form);
        if (!result.ok) { setError(result.error); return; }
        forgetRetakeOperation(record);
        setOutcome({ result: result.outcome, permissionId: result.permissionId, action: record.operation }); setRecord(null);
      } catch { setError("Belum dapat mengamankan permintaan. Periksa koneksi dan coba lagi."); }
    });
  }
  return <>
    {storageError && <Alert variant="destructive" role="alert" className="mb-5 max-w-5xl"><CircleAlert className="size-4" /><AlertTitle>Penyimpanan sesi tidak tersedia atau rusak</AlertTitle><AlertDescription>Tindakan izin dinonaktifkan untuk mencegah hasil yang tidak pasti. Gunakan tab yang sama dan hubungi pengelola jika identitas permintaan hilang.</AlertDescription></Alert>}
    {(record || outcome) && <Dialog open><DialogContent showCloseButton={false} onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()} className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md">
      <DialogHeader><DialogTitle>Hasil tindakan izin belum pasti</DialogTitle><DialogDescription>Periksa dan amankan sebelum mengubah izin lain. Jangan tutup tab atau hapus data sesi browser sampai selesai.</DialogDescription></DialogHeader>
      {!outcome ? <p className="text-sm leading-6 text-muted-foreground">Server memeriksa apakah tindakan sempat berhasil. Jika belum, permintaan lama dipagari agar tidak berlaku saat datang terlambat.</p>
        : <Alert role="status"><Info className="size-4" /><AlertTitle>{outcome.result === "applied" ? "Tindakan sempat berhasil" : "Permintaan diamankan"}</AlertTitle><AlertDescription>{outcome.result === "applied"
          ? `Tindakan ${outcome.action === "grant" ? "pemberian" : "pencabutan"} berlaku pada izin #${outcome.permissionId}. Muat ulang untuk memeriksa status terkini; izin mungkin sudah berubah atau digunakan.`
          : "Permintaan yang belum berhasil dibatalkan dan tidak dapat mengubah izin jika datang terlambat."}</AlertDescription></Alert>}
      {error && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>{error} <Link href="/login" className="underline">Masuk kembali di tab ini</Link>.</AlertDescription></Alert>}
      <DialogFooter>{outcome ? <Button type="button" onClick={() => { setOutcome(null); router.refresh(); }}>Tutup dan muat ulang status</Button>
        : <Button type="button" disabled={pending} onClick={resolve}>{pending ? "Memeriksa…" : "Periksa dan amankan"}</Button>}</DialogFooter>
    </DialogContent></Dialog>}
  </>;
}
