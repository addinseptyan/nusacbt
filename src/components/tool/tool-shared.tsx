"use client";

import { CheckCircle2, CircleAlert, History, KeyRound, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type {
  BackupAuditEntry,
  DatabaseSummaryMetrics,
  KeyCheckReport,
  KeyCompatibilityStatus,
} from "@/lib/database-backup-service";

export const toolCardClass =
  "gap-0 rounded-[20px] p-5 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
}

export function formatToolDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Jakarta",
  }).format(parsed);
}

const KEY_LABELS: Record<KeyCompatibilityStatus, { label: string; ok: boolean }> = {
  matched: { label: "Cocok dengan pengikat", ok: true },
  unbound: { label: "Belum terikat", ok: true },
  mismatch: { label: "Kunci berbeda", ok: false },
  missing_key: { label: "Kunci belum disiapkan", ok: false },
  invalid_key: { label: "File kunci tidak valid", ok: false },
  same_key: { label: "Duplikat dengan kunci sandi", ok: false },
  inconsistent: { label: "Pengikat hilang", ok: false },
};

export function KeyStatusRow({
  label,
  status,
  configured,
}: {
  label: string;
  status: KeyCompatibilityStatus;
  configured: boolean;
}) {
  const info = KEY_LABELS[status];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-background/60 px-3.5 py-2.5 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4 shrink-0 text-muted-foreground" />
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge
          variant={info.ok ? "secondary" : "destructive"}
          className={
            info.ok
              ? "rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
              : "rounded-full"
          }
        >
          {info.ok ? <CheckCircle2 className="mr-1 size-3.5" /> : <CircleAlert className="mr-1 size-3.5" />}
          {info.label}
        </Badge>
        {!configured && status === "unbound" && (
          <span className="text-xs text-muted-foreground">(file opsional sebelum fitur dipakai)</span>
        )}
      </div>
    </div>
  );
}

export function SummaryMetricsGrid({ summary }: { summary: DatabaseSummaryMetrics }) {
  const items = [
    { label: "Admin & operator", value: `${summary.adminUsers} akun` },
    { label: "Data siswa", value: `${summary.students} siswa` },
    { label: "Bank soal", value: `${summary.questions} soal (${summary.questionImages} gambar)` },
    { label: "Tes & pelaksanaan", value: `${summary.examTests} tes` },
    { label: "Pengerjaan ujian", value: `${summary.attempts} pengerjaan (${summary.snapshotImages} gambar snapshot)` },
    {
      label: "Logo & kop sekolah",
      value: `${summary.hasBrandingLogo ? "Logo ada" : "Tanpa logo"} · ${summary.hasBrandingLetterhead ? "Kop ada" : "Tanpa kop"}`,
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-border/80 bg-background/60 px-3.5 py-3"
        >
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function KeySecuritySummary({ keyCheck }: { keyCheck: KeyCheckReport }) {
  return (
    <div className="space-y-2.5">
      <KeyStatusRow
        label="Kunci sandi peserta (NUSACBT_PARTICIPANT_KEY_FILE)"
        status={keyCheck.participantKeyStatus}
        configured={keyCheck.participantConfigured}
      />
      <KeyStatusRow
        label="Kunci token ujian (NUSACBT_EXAM_TOKEN_KEY_FILE)"
        status={keyCheck.tokenKeyStatus}
        configured={keyCheck.tokenConfigured}
      />
      <p className="flex items-start gap-2 pt-1 text-xs leading-5 text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span>
          File kunci enkripsi dan <code>.env.local</code> sengaja tidak dimasukkan ke arsip cadangan. Simpan salinan file kunci secara terpisah di tempat aman.
        </span>
      </p>
    </div>
  );
}

export function BackupAuditList({ logs }: { logs: BackupAuditEntry[] }) {
  return (
    <Card className={toolCardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="size-4 text-primary" />
          <h2 className="text-base font-bold">Riwayat backup & pemulihan</h2>
        </div>
        <span className="text-xs text-muted-foreground">20 aktivitas terbaru</span>
      </div>
      {logs.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Belum ada catatan pembuatan cadangan atau pemulihan pada database ini.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 pr-3 font-semibold">Waktu (WIB)</th>
                <th className="py-2 pr-3 font-semibold">Tindakan</th>
                <th className="py-2 pr-3 font-semibold">Admin</th>
                <th className="py-2 pr-3 font-semibold">Arsip & SHA-256</th>
                <th className="py-2 pr-3 font-semibold">Ringkasan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {logs.map((item) => (
                <tr key={item.id} className="align-top">
                  <td className="py-2.5 pr-3 whitespace-nowrap text-muted-foreground">
                    {formatToolDateTime(item.occurredAt)}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    <Badge
                      variant={item.action === "backup" ? "secondary" : "outline"}
                      className={
                        item.action === "restore"
                          ? "rounded-full border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                          : "rounded-full"
                      }
                    >
                      {item.action === "backup" ? "Backup" : "Pemulihan"}
                    </Badge>
                  </td>
                  <td className="py-2.5 pr-3 font-medium whitespace-nowrap">{item.actorUsername}</td>
                  <td className="py-2.5 pr-3">
                    <div className="font-medium text-foreground">{item.archiveFilename}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {item.archiveSha256.slice(0, 16)}… · {formatBytes(item.byteSize)}
                    </div>
                  </td>
                  <td className="py-2.5 text-muted-foreground">{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
