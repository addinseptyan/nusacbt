"use client";

import { AlertTriangle, CheckCircle2, CircleAlert, Database, Download, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  BackupAuditList,
  formatBytes,
  KeySecuritySummary,
  SummaryMetricsGrid,
  toolCardClass,
} from "@/components/tool/tool-shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { ToolDashboardData } from "@/lib/database-backup-service";

function filenameFromHeader(header: string | null): string {
  if (!header) return "backup-nusacbt.zip";
  const match = header.match(/filename="([^"]+)"/i);
  return match?.[1] || "backup-nusacbt.zip";
}

export function BackupManager({ data }: { data: ToolDashboardData }) {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [lastBackup, setLastBackup] = useState<{
    filename: string;
    size: number;
    sha256: string;
  } | null>(null);

  async function handleDownloadBackup() {
    if (downloading) return;
    setDownloading(true);
    setError("");
    try {
      const response = await fetch("/tool/backup/unduh", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-NusaCBT-Export": "1",
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const message = (await response.text()).trim();
        setError(message || "Cadangan database gagal dibuat.");
        return;
      }
      const blob = await response.blob();
      const filename = filenameFromHeader(response.headers.get("content-disposition"));
      const sha256 = response.headers.get("x-nusacbt-archive-sha256") ?? "";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setLastBackup({ filename, size: blob.size, sha256 });
      toast.success(`Cadangan ${filename} berhasil diunduh.`);
      router.refresh();
    } catch {
      setError("Koneksi terputus saat mengunduh cadangan database.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-5">
      {data.activeOngoingAttempts > 0 && (
        <Alert
          role="alert"
          className="rounded-2xl border-amber-300 bg-amber-50/90 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-300" />
          <AlertTitle className="font-bold">Sedang ada ujian berlangsung</AlertTitle>
          <AlertDescription className="mt-1">
            Saat ini terdapat <strong>{data.activeOngoingAttempts}</strong> pengerjaan peserta yang masih aktif. Pembuatan cadangan tetap berjalan secara konsisten (snapshot read), tetapi pemulihan database dilarang selama ada ujian aktif.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" role="alert" className="rounded-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Cadangan gagal dibuat</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {lastBackup && (
        <Alert
          role="status"
          className="rounded-2xl border-emerald-300 bg-emerald-50/80 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
        >
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-300" />
          <AlertTitle className="font-bold">Cadangan siap disimpan</AlertTitle>
          <AlertDescription className="mt-1 space-y-1">
            <p>
              Berkas <strong>{lastBackup.filename}</strong> ({formatBytes(lastBackup.size)}) telah selesai dibuat dan diunduh.
            </p>
            {lastBackup.sha256 && (
              <p className="font-mono text-xs break-all">SHA-256: {lastBackup.sha256}</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Card className={toolCardClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <Database className="size-5" />
              </span>
              <div>
                <h2 className="text-lg font-bold">Buat cadangan penuh (.zip)</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Mengemas seluruh tabel database NusaCBT, riwayat pengerjaan, gambar bank soal, gambar snapshot, dan logo ke dalam satu arsip berintegritas SHA-256 tanpa memerlukan program eksternal <code>pg_dump</code>.
                </p>
              </div>
            </div>
            <Badge variant="outline" className="rounded-full font-mono text-[11px]">
              {data.schemaVersion || "-"}
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="rounded-full">
              DB: {data.databaseName} ({data.encoding})
            </Badge>
            <Badge variant="secondary" className="rounded-full">
              PostgreSQL {data.serverVersion.split(" ")[0] || "-"}
            </Badge>
            <Badge variant="secondary" className="rounded-full">
              {data.migrationCount} migrasi skema
            </Badge>
          </div>

          <div className="mt-5">
            <SummaryMetricsGrid summary={data.summary} />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Button
              type="button"
              onClick={handleDownloadBackup}
              disabled={downloading}
              className="h-10 rounded-xl px-5 font-semibold"
            >
              {downloading ? (
                <>
                  <Spinner aria-hidden="true" /> Menyiapkan arsip…
                </>
              ) : (
                <>
                  <Download className="size-4" /> Unduh backup database (.zip)
                </>
              )}
            </Button>
            <Button asChild variant="outline" className="h-10 rounded-xl">
              <Link href="/tool/pemulihan" prefetch={false}>
                Buka Upload / Pemulihan Database
              </Link>
            </Button>
          </div>
        </Card>

        <Card className={toolCardClass}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <h2 className="text-base font-bold">Status kunci enkripsi & keamanan</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Pemulihan cadangan pada server baru memerlukan file kunci yang sama dengan database asal.
          </p>
          <div className="mt-4">
            <KeySecuritySummary keyCheck={data.keyCheck} />
          </div>
        </Card>
      </div>

      <BackupAuditList logs={data.auditLogs} />
    </div>
  );
}
