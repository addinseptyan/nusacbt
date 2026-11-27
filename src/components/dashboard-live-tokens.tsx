"use client";

import Link from "next/link";
import { ArrowRight, Globe2, KeyRound, Radio } from "lucide-react";

import { formatTime, remaining, TokenCode, tokenName, tokenStatus, useServerNow } from "@/app/data-tes/token/token-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ExamTimeZone } from "@/lib/exam-test-types";
import type { AccessTokenRecord, TokenKeyStatus } from "@/lib/exam-token-types";

export function DashboardLiveTokens({
  tokens,
  serverNow,
  keyStatus,
  defaultTimeZone = "WIB",
}: {
  tokens: AccessTokenRecord[];
  serverNow: string;
  keyStatus: TokenKeyStatus;
  defaultTimeZone?: ExamTimeZone;
}) {
  const now = useServerNow(serverNow);
  const liveTokens = tokens.filter((token) => tokenStatus(token, now) === "Aktif");

  return (
    <Card className="mt-4 gap-0 rounded-[18px] bg-card p-5 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
            <KeyRound className="size-[18px]" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-bold">Token Live</h2>
              {liveTokens.length > 0 ? (
                <Badge
                  data-testid="live-token-badge"
                  className="gap-1.5 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-emerald-950"
                >
                  <span aria-hidden="true" data-testid="live-token-ping" className="relative flex size-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-80 motion-reduce:animate-none" />
                    <span className="relative inline-flex size-2 rounded-full bg-white" />
                  </span>
                  LIVE · {liveTokens.length} aktif
                </Badge>
              ) : (
                <Badge variant="outline" className="rounded-full text-[10px] font-medium text-muted-foreground">
                  Tidak ada yang aktif
                </Badge>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Daftar token ujian yang sedang aktif saat ini beserta sisa masa berlakunya.
            </p>
          </div>
        </div>
        <Button asChild variant="ghost" className="h-9 rounded-lg text-[11px] font-semibold text-primary">
          <Link href="/data-tes/token" prefetch={false}>
            Kelola token <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>

      {liveTokens.length > 0 ? (
        <div className="mt-4 overflow-x-auto" data-testid="dashboard-live-token-table-container">
          <table className="w-full min-w-[680px] text-left text-xs" aria-label="Tabel token live">
            <thead className="border-b bg-muted/40 text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Cakupan / Tes</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Kode Token</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Sisa Waktu</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Berakhir ({defaultTimeZone})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {liveTokens.map((token) => (
                <tr key={token.id} data-testid="dashboard-live-token-row" className="align-middle">
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                      <span aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />
                      Aktif
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                      {token.scope === "global" ? (
                        <Globe2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Radio className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      )}
                      <span className="break-words">{tokenName(token)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Token #{token.id} · {token.scope === "global" ? "Berlaku untuk tes tanpa token khusus" : "Token khusus tes"}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <TokenCode token={token} label={`Kode live token ${token.id}`} now={now} />
                  </td>
                  <td className="px-3 py-3 font-mono text-sm font-bold whitespace-nowrap tabular-nums">
                    {remaining(token, now)}
                  </td>
                  <td className="px-3 py-3 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatTime(token.expiresAt, defaultTimeZone)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {keyStatus !== "ready" && (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
              Kunci dekripsi token belum siap ({keyStatus}). Buka menu <Link href="/data-tes/token" className="font-semibold underline">Token</Link> untuk memeriksa konfigurasi kunci.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
          <KeyRound className="size-5 text-muted-foreground/55" />
          <p className="mt-2 text-[12px] font-semibold text-foreground">Belum ada token live yang aktif</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Aktifkan token global atau khusus tes di <Link href="/data-tes/token" prefetch={false} className="font-semibold text-primary underline">menu Token</Link> agar tampil live di sini.
          </p>
        </div>
      )}
    </Card>
  );
}
