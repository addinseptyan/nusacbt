"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CircleAlert, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { executeDevCascadeAction, inspectDevCascadeAction } from "@/app/pengaturan/dev-delete/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { DevCascadeEntityType, DevCascadeInspection } from "@/lib/dev-cascade-delete-service";

function DevCascadeDeleteContent({
  entityType,
  entityId,
  displayName,
  onDismiss,
}: {
  entityType: DevCascadeEntityType;
  entityId: string;
  displayName: string;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(true);
  const [inspection, setInspection] = useState<DevCascadeInspection | null>(null);
  const [error, setError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [typedPhrase, setTypedPhrase] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    inspectDevCascadeAction(entityType, entityId)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) setError(res.error);
        else setInspection(res.inspection);
      })
      .catch(() => {
        if (!cancelled) setError("Gagal memuat daftar dependensi. Muat ulang halaman.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  function handleClose() {
    if (pending) return;
    onDismiss();
  }

  function handleExecute() {
    if (!inspection || pending) return;
    setError("");
    startTransition(async () => {
      try {
        const res = await executeDevCascadeAction(entityType, entityId, typedPhrase);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        onDismiss();
        toast.success(res.message);
        router.refresh();
      } catch {
        setError("Penghapusan belum dapat dipastikan. Muat ulang halaman dan periksa kembali.");
      }
    });
  }

  const phraseMatch =
    inspection !== null && typedPhrase.trim() === inspection.confirmPhrase;
  const blocked = Boolean(inspection && inspection.blockedActiveAttempts > 0);

  return (
    <Dialog open onOpenChange={(next) => { if (!next) handleClose(); }}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg"
        showCloseButton={!pending}
        onEscapeKeyDown={(e) => { if (pending) e.preventDefault(); }}
        onInteractOutside={(e) => { if (pending) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-destructive">
            <ShieldAlert className="size-5 shrink-0" />
            Hapus beserta dependensi (Mode Dev)
          </DialogTitle>
          <DialogDescription>
            Target: <strong className="break-words text-foreground">{inspection?.entityLabel ?? displayName}</strong>
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Memeriksa seluruh dependensi terkait di database...
          </p>
        )}

        {error && (
          <Alert variant="destructive" role="alert">
            <CircleAlert className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && inspection && step === 1 && (
          <div className="space-y-4">
            {blocked ? (
              <Alert variant="destructive" role="alert">
                <AlertTriangle className="size-4" />
                <AlertTitle>Tidak dapat dihapus saat ujian aktif</AlertTitle>
                <AlertDescription>
                  Terdapat <strong>{inspection.blockedActiveAttempts}</strong> pengerjaan peserta yang sedang berlangsung aktif. Tunggu hingga selesai sebelum menghapus data ini.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                <AlertTriangle className="size-4 text-amber-600 dark:text-amber-300" />
                <AlertTitle className="text-xs font-bold">Konfirmasi Tahap 1 dari 2 — Rincian Dependensi</AlertTitle>
                <AlertDescription className="text-xs leading-5">
                  Penghapusan permanen ini tidak dapat dibatalkan dan akan ikut menghapus data terkait di bawah:
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-xl border border-border bg-muted/30 p-3.5">
              {inspection.dependencies.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Tidak ada data dependensi turunan yang tercatat pada target ini.
                </p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {inspection.dependencies.map((dep) => (
                    <li key={dep.label} className="flex items-center justify-between gap-2">
                      <span className="text-foreground">{dep.label}</span>
                      <Badge variant="secondary" className="tabular-nums">
                        {dep.count} data
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!blocked && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-destructive"
                />
                <span>
                  Saya memahami bahwa <strong>{inspection.entityLabel}</strong> dan{" "}
                  <strong>{inspection.totalDependentRows}</strong> data terkait di atas akan dihapus permanen.
                </span>
              </label>
            )}
          </div>
        )}

        {!loading && inspection && step === 2 && !blocked && (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle className="text-xs font-bold">Konfirmasi Tahap 2 dari 2 — Verifikasi Akhir</AlertTitle>
              <AlertDescription className="text-xs leading-5">
                Ketik <code className="rounded bg-background px-1.5 py-0.5 font-bold">{inspection.confirmPhrase}</code> untuk mengeksekusi penghapusan permanen.
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <label htmlFor="dev-cascade-confirm-input" className="text-xs font-semibold">
                Frasa konfirmasi
              </label>
              <Input
                id="dev-cascade-confirm-input"
                value={typedPhrase}
                onChange={(e) => setTypedPhrase(e.target.value)}
                placeholder={inspection.confirmPhrase}
                disabled={pending}
                autoComplete="off"
                className="h-10 rounded-xl font-mono"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={handleClose}>
            Batal
          </Button>
          {!loading && inspection && !blocked && step === 1 && (
            <Button
              type="button"
              variant="destructive"
              disabled={!acknowledged}
              onClick={() => setStep(2)}
            >
              Lanjutkan ke konfirmasi akhir
            </Button>
          )}
          {!loading && inspection && !blocked && step === 2 && (
            <Button
              type="button"
              variant="destructive"
              disabled={!phraseMatch || pending}
              onClick={handleExecute}
            >
              {pending ? <Spinner aria-hidden="true" /> : <Trash2 className="size-4" />}
              {pending ? "Menghapus permanen..." : "Ya, hapus permanen semua"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DevCascadeDeleteDialog({
  open,
  entityType,
  entityId,
  entityName,
  entityTitle,
  onClose,
  onOpenChange,
}: {
  open: boolean;
  entityType: DevCascadeEntityType;
  entityId: string | null;
  entityName?: string;
  entityTitle?: string;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  if (!open || !entityId) return null;
  return (
    <DevCascadeDeleteContent
      key={`${entityType}:${entityId}`}
      entityType={entityType}
      entityId={entityId}
      displayName={entityName ?? entityTitle ?? ""}
      onDismiss={() => {
        onClose?.();
        onOpenChange?.(false);
      }}
    />
  );
}
