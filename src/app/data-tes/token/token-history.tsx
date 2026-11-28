"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Info, RefreshCw } from "lucide-react";

import { formatTime, TokenCode, tokenName, tokenStatus, useServerNow, type Zone } from "@/app/data-tes/token/token-display";
import { tokenHistoryUrl, tokenUrl, type DateFilter } from "@/app/data-tes/token/token-links";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AccessTokenRecord, TokenKeyStatus } from "@/lib/exam-token-types";

type Props = {
  history: AccessTokenRecord[]; page: number; pages: number; total: number; serverNow: string;
  keyStatus: TokenKeyStatus; keyMessage: string; zone: Zone; defaultTimeZone?: Zone; filter: DateFilter; fromPage: number;
};

export function TokenHistory({ history, page, pages, total, serverNow, keyStatus, keyMessage, zone, defaultTimeZone = "WIB", filter, fromPage }: Props) {
  const router = useRouter(); const now = useServerNow(serverNow);
  return <>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <Button asChild variant="outline" className="h-10 rounded-xl"><Link href={tokenUrl(zone, filter, fromPage, defaultTimeZone)} prefetch={false}><ArrowLeft className="size-4" /> Kembali ke Token</Link></Button>
      <div className="flex flex-wrap items-end gap-2"><div className="flex h-10 items-center rounded-xl border border-input bg-muted/40 px-3 text-xs font-semibold text-muted-foreground">Zona {zone} · Pengaturan Aplikasi</div><Button type="button" variant="outline" onClick={() => router.refresh()} className="h-10 rounded-xl"><RefreshCw className="size-4" /> Muat ulang</Button></div>
    </div>
    {keyStatus !== "ready" && <Alert variant="destructive" role="alert" className="mb-5 max-w-4xl"><Info className="size-4" /><AlertTitle>Kunci token perlu diperiksa</AlertTitle><AlertDescription>{keyMessage} Metadata riwayat tetap tersedia.</AlertDescription></Alert>}
    <Card className="gap-0 overflow-hidden rounded-[18px] py-0 shadow-sm"><div className="border-b border-border p-5 sm:px-6"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-bold">Catatan token</h2><Badge variant="secondary">{total} catatan</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">Kode baru tetap dapat dilihat setelah kedaluwarsa atau dicabut. Status juga mengikuti jadwal tes saat ini. Catatan tidak dihapus otomatis; kode lama sebelum fitur enam digit tidak dapat dipulihkan.</p></div>
      {!history.length ? <p className="px-6 py-10 text-center text-sm text-muted-foreground">Belum ada riwayat token.</p> : <ul aria-label="Riwayat token" className="divide-y divide-border">{history.map((token) => { const status = tokenStatus(token, now); return <li key={token.id} className="flex flex-wrap items-center justify-between gap-4 p-5 sm:px-6"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-bold">{tokenName(token)}</h3><Badge variant={status === "Aktif" ? "default" : "secondary"}>{status}</Badge>{token.testTags.map((tag) => <Badge key={tag} variant="outline" className="rounded-full text-[10px] font-medium">{tag}</Badge>)}</div><p className="mt-1 text-xs text-muted-foreground">Token #{token.id} · {token.durationMinutes} menit · dibuat oleh {token.createdBy ?? "admin tidak tersedia"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Dibuat {formatTime(token.issuedAt, zone)} · Berakhir {formatTime(token.expiresAt, zone)}</p>{token.revokedAt && <p className="mt-1 text-xs text-muted-foreground">{token.revokedReason === "replaced" ? "Diganti/ditutup" : "Dicabut"} {formatTime(token.revokedAt, zone)}</p>}</div><TokenCode token={token} label={`Kode riwayat token ${token.id}`} now={now} /></li>; })}</ul>}
      {pages > 1 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-5 text-xs sm:px-6"><span>Halaman {page} dari {pages}</span><div className="flex gap-2">{page > 1 && <Button asChild variant="outline" size="sm"><Link href={tokenHistoryUrl(zone, filter, fromPage, page - 1, defaultTimeZone)} prefetch={false}><ChevronLeft className="size-4" /> Sebelumnya</Link></Button>}{page < pages && <Button asChild variant="outline" size="sm"><Link href={tokenHistoryUrl(zone, filter, fromPage, page + 1, defaultTimeZone)} prefetch={false}>Berikutnya <ChevronRight className="size-4" /></Link></Button>}</div></div>}
    </Card>
  </>;
}
