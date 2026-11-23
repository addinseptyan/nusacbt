"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  DatabaseZap,
  FileArchive,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  BackupAuditList,
  formatBytes,
  formatToolDateTime,
  KeySecuritySummary,
  SummaryMetricsGrid,
  toolCardClass,
} from "@/components/tool/tool-shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { RestorePreviewReport, ToolDashboardData } from "@/lib/database-backup-service";

export function RestoreManager({ data }: { data: ToolDashboardData }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RestorePreviewReport | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [error, setError] = useState("");
  const [restoreDoneMessage, setRestoreDoneMessage] = useState("");

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setPreview(null);
    setError("");
    setRestoreDoneMessage("");
  }

  async function handleInspectBackup() {
    if (!selectedFile || inspecting || restoring) return;
    setInspecting(true);
    setError("");
    setPreview(null);
    setRestoreDoneMessage("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/tool/pemulihan/pratinjau", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-NusaCBT-Tool": "1" },
        body: formData,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        setError(json?.error || "Berkas cadangan tidak dapat diperiksa.");
        return;
      }
      setPreview(json.preview as RestorePreviewReport);
    } catch {
      setError("Koneksi terputus saat memeriksa arsip cadangan.");
    } finally {
      setInspecting(false);
    }
  }

  async function handleExecuteRestore() {
    if (!selectedFile || !preview || !preview.canRestore || restoring) return;
    setRestoring(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("expectedArchiveSha256", preview.archiveSha256);
      formData.append("confirmPhrase", confirmPhrase.trim());

      const response = await fetch("/tool/pemulihan/jalankan", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-NusaCBT-Tool": "1" },
        body: formData,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        setError(json?.error || "Pemulihan database gagal dijalankan.");
        return;
      }

      setConfirmOpen(false);
      setConfirmPhrase("");
      if (!json.sessionPreserved) {
        toast.success("Database berhasil dipulihkan. Silakan masuk kembali.");
        router.push("/login?sesi=pemulihan");
        return;
      }

      setPreview(null);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setRestoreDoneMessage(
        `Database berhasil dipulihkan dari ${json.archiveFilename} (${json.totalRows} baris, ${json.blobCount} berkas biner). Sesi peserta dibersihkan.`,
      );
      toast.success("Database berhasil dipulihkan.");
      router.refresh();
    } catch {
      setError("Koneksi terputus saat menjalankan pemulihan database.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-5">
      <Alert className="rounded-2xl border-amber-300 bg-amber-50/90 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        <ShieldAlert className="size-4 text-amber-600 dark:text-amber-300" />
        <AlertTitle className="font-bold">Prosedur pemeliharaan sebelum pemulihan</AlertTitle>
        <AlertDescription className="mt-1 text-xs leading-5">
          Pemulihan akan <strong>mengganti seluruh data saat ini</strong> di database dengan isi arsip cadangan dalam satu transaksi atomik. Selalu buat cadangan kondisi terbaru lebih dahulu, pastikan tidak ada ujian aktif, dan uji cadangan di lingkungan uji sebelum digunakan pada data sekolah.
        </AlertDescription>
      </Alert>

      {data.activeOngoingAttempts > 0 && (
        <Alert variant="destructive" role="alert" className="rounded-2xl">
          <AlertTriangle className="size-4" />
          <AlertTitle>Pemulihan diblokir saat ujian berlangsung</AlertTitle>
          <AlertDescription>
            Terdapat <strong>{data.activeOngoingAttempts}</strong> pengerjaan ujian aktif yang belum selesai. Tunggu hingga ujian selesai atau jadwal ditutup sebelum memulihkan database.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" role="alert" className="rounded-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Pemeriksaan / pemulihan gagal</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {restoreDoneMessage && (
        <Alert
          role="status"
          className="rounded-2xl border-emerald-300 bg-emerald-50/80 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
        >
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-300" />
          <AlertTitle className="font-bold">Pemulihan berhasil</AlertTitle>
          <AlertDescription>{restoreDoneMessage}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card className={toolCardClass}>
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <FileArchive className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold">1. Pilih & periksa berkas cadangan (.zip)</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sistem akan memverifikasi CRC32, tanda tangan SHA-256 setiap tabel dan gambar, kecocokan versi migrasi skema ({data.schemaVersion}), serta kecocokan kunci enkripsi sebelum mengizinkan pemulihan.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <label htmlFor="backup-archive-input" className="block text-sm font-medium">
              Berkas cadangan NusaCBT (maksimal 64 MiB)
            </label>
            <Input
              ref={fileInputRef}
              id="backup-archive-input"
              type="file"
              accept=".zip,application/zip"
              onChange={handleFileChange}
              disabled={inspecting || restoring}
              className="h-11 cursor-pointer rounded-xl file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1 file:text-xs file:font-semibold file:text-accent-foreground"
            />
            {selectedFile && (
              <p className="text-xs text-muted-foreground">
                Terpilih: <strong>{selectedFile.name}</strong> ({formatBytes(selectedFile.size)})
              </p>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Button
              type="button"
              onClick={handleInspectBackup}
              disabled={!selectedFile || inspecting || restoring}
              className="h-10 rounded-xl px-5 font-semibold"
            >
              {inspecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Memeriksa arsip…
                </>
              ) : (
                "Periksa pratinjau cadangan"
              )}
            </Button>
            <Button asChild variant="outline" className="h-10 rounded-xl">
              <Link href="/tool/backup" prefetch={false}>
                Buat backup baru dulu
              </Link>
            </Button>
          </div>
        </Card>

        <Card className={toolCardClass}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <h2 className="text-base font-bold">Kondisi server target saat ini</h2>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="secondary" className="rounded-full font-mono text-[11px]">
              Skema: {data.schemaVersion}
            </Badge>
            <Badge variant="secondary" className="rounded-full">
              DB: {data.databaseName} ({data.encoding})
            </Badge>
            <Badge variant={data.activeOngoingAttempts === 0 ? "secondary" : "destructive"} className="rounded-full">
              Ujian aktif: {data.activeOngoingAttempts}
            </Badge>
          </div>
          <div className="mt-4">
            <KeySecuritySummary keyCheck={data.keyCheck} />
          </div>
        </Card>
      </div>

      {preview && (
        <Card className={toolCardClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">2. Hasil pratinjau & verifikasi kompatibilitas</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Arsip <strong>{preview.archiveFilename}</strong> ({formatBytes(preview.byteSize)}) dibuat pada{" "}
                <strong>{formatToolDateTime(preview.createdAt)}</strong> dari DB <code>{preview.sourceDatabaseName}</code>.
              </p>
            </div>
            <Badge
              variant={preview.canRestore ? "secondary" : "destructive"}
              className={
                preview.canRestore
                  ? "rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                  : "rounded-full"
              }
            >
              {preview.canRestore ? "Siap dipulihkan" : "Tidak dapat dipulihkan"}
            </Badge>
          </div>

          <div className="mt-3 rounded-xl border border-border/80 bg-background/60 px-3.5 py-2.5 text-xs">
            <span className="text-muted-foreground">Sidik SHA-256 arsip: </span>
            <code className="font-mono break-all text-foreground">{preview.archiveSha256}</code>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-background/60 px-3.5 py-2.5 text-sm">
              <span>Kecocokan skema migrasi</span>
              <Badge variant={preview.schemaCompatible ? "secondary" : "destructive"} className="rounded-full">
                {preview.schemaMessage}
              </Badge>
            </div>
            <KeySecuritySummary keyCheck={preview.keyCheck} />
          </div>

          {preview.blockers.length > 0 && (
            <Alert variant="destructive" role="alert" className="mt-4 rounded-2xl">
              <CircleAlert className="size-4" />
              <AlertTitle>Pemulihan tidak dapat dijalankan</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {preview.blockers.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {preview.warnings.length > 0 && (
            <Alert className="mt-4 rounded-2xl border-amber-300 bg-amber-50/70 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-300" />
              <AlertTitle>Catatan pemulihan</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {preview.warnings.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="mt-5">
            <p className="mb-2.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Isi cadangan ({preview.tableCount} tabel · {preview.totalRows} baris · {preview.blobCount} berkas biner · {formatBytes(preview.totalBlobBytes)})
            </p>
            <SummaryMetricsGrid summary={preview.summary} />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="destructive"
              disabled={!preview.canRestore || restoring}
              onClick={() => {
                setConfirmPhrase("");
                setConfirmOpen(true);
              }}
              className="h-10 rounded-xl px-5 font-semibold"
            >
              <DatabaseZap className="size-4" /> Pulihkan database…
            </Button>
          </div>
        </Card>
      )}

      <BackupAuditList logs={data.auditLogs} />

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!restoring) setConfirmOpen(open);
        }}
      >
        <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>Konfirmasi pemulihan database</DialogTitle>
            <DialogDescription>
              Tindakan ini mengganti seluruh data saat ini dengan isi berkas cadangan secara atomik.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto px-6 py-4 text-sm">
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3.5 text-xs leading-5">
              <p className="font-semibold text-destructive">Perhatian sebelum melanjutkan:</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                <li>Data siswa, soal, jadwal, pengerjaan, dan nilai setelah cadangan ini dibuat akan hilang.</li>
                <li>Seluruh sesi login peserta akan diakhiri secara otomatis.</li>
                <li>Jika akun atau sesi admin Anda saat ini tidak terdapat di cadangan, Anda akan diarahkan masuk ulang.</li>
              </ul>
            </div>
            <div>
              <label htmlFor="confirm-restore-phrase" className="block text-xs font-semibold">
                Ketik <code>PULIHKAN</code> untuk mengonfirmasi:
              </label>
              <Input
                id="confirm-restore-phrase"
                value={confirmPhrase}
                onChange={(e) => setConfirmPhrase(e.target.value)}
                placeholder="PULIHKAN"
                autoComplete="off"
                disabled={restoring}
                className="mt-2 h-10 rounded-xl font-mono"
              />
            </div>
          </div>
          <DialogFooter className="border-t border-border px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={restoring}
              className="rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleExecuteRestore}
              disabled={confirmPhrase.trim() !== "PULIHKAN" || restoring}
              className="rounded-xl font-semibold"
            >
              {restoring ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Memulihkan…
                </>
              ) : (
                "Ya, pulihkan database"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
