"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TOKEN_ZONE_OFFSETS } from "@/lib/exam-token-date.mjs";
import type { AccessTokenRecord } from "@/lib/exam-token-types";

export type Zone = "WIB" | "WITA" | "WIT";
export type TokenStatus = "Aktif" | "Kedaluwarsa" | "Dicabut" | "Diganti" | "Tes dihapus" | "Jadwal berakhir";

export function useServerNow(serverNow: string) {
  const router = useRouter(); const [clock, setClock] = useState({ serverNow, elapsed: 0 });
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => setClock({ serverNow, elapsed: performance.now() - started }), 1000);
    return () => window.clearInterval(timer);
  }, [serverNow]);
  useEffect(() => {
    // Jam monotonic/timer browser bisa tertunda ketika tab atau perangkat tidur.
    // Sinkronkan lagi dengan database saat admin kembali ke halaman.
    let lastRefresh = -Infinity;
    const refresh = () => {
      if (document.visibilityState !== "visible" || performance.now() - lastRefresh < 1000) return;
      lastRefresh = performance.now(); router.refresh();
    };
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", pageShow);
    return () => { document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", pageShow); };
  }, [router]);
  return Date.parse(serverNow) + (clock.serverNow === serverNow ? clock.elapsed : 0);
}

export function formatTime(value: string, zone: Zone) {
  const date = new Date(Date.parse(value) + TOKEN_ZONE_OFFSETS[zone] * 3_600_000); const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${zone}`;
}

export function tokenStatus(token: AccessTokenRecord, now: number): TokenStatus {
  const expires = Date.parse(token.expiresAt);
  if (token.revokedAt && Date.parse(token.revokedAt) < expires) return token.revokedReason === "replaced" ? "Diganti" : "Dicabut";
  if (token.scope === "test" && !token.testId && !token.revokedAt) return "Tes dihapus";
  if (token.revokedAt || expires <= now) return "Kedaluwarsa";
  // Masa token bisa lebih panjang dari jadwal. Kode khusus tidak bisa digunakan
  // untuk tes yang sudah berakhir walaupun masa tokennya sendiri masih tersisa.
  if (token.scope === "test" && token.testEndsAt && Date.parse(token.testEndsAt) <= now) return "Jadwal berakhir";
  return "Aktif";
}

export function remaining(token: AccessTokenRecord | null, now: number) {
  const seconds = token && tokenStatus(token, now) === "Aktif" ? Math.max(0, Math.ceil((Date.parse(token.expiresAt) - now) / 1000)) : 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds % 3600 / 60))}:${pad(seconds % 60)}`;
}

export function tokenName(token: AccessTokenRecord) {
  if (token.scope === "global") return "Token global";
  return token.testId ? `${token.currentTestName ?? token.testNameSnapshot ?? "Tes"} · #${token.testId}${token.periodName ? ` · ${token.periodName}` : ""}` : `${token.testNameSnapshot ?? "Tes"} (tes dihapus)`;
}

export function TokenCode({ token, label, now }: { token: AccessTokenRecord | null; label: string; now: number }) {
  const code = token?.code;
  const status = token ? tokenStatus(token, now) : null;
  const inactive = Boolean(status && status !== "Aktif");
  const text = !token ? "Belum ada" : code ?? (token.codeStatus === "legacy" ? "Kode lama tidak tersedia" : token.codeStatus === "corrupt" ? "Data token tidak dapat dibuka" : "Kunci tidak tersedia");
  async function copy() {
    if (!code || inactive) return;
    try { if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable"); await navigator.clipboard.writeText(code); toast.success("Kode disalin; bagikan hanya kepada pihak berwenang."); }
    catch { toast.error("Penyalinan otomatis tidak tersedia. Pilih kode untuk menyalin manual."); }
  }
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <span aria-label={label} className={code ? `font-mono text-xl font-bold tracking-[0.16em] ${inactive ? "text-muted-foreground" : "text-foreground"}` : "text-xs font-medium text-muted-foreground"}>{text}</span>
    {inactive && <Badge variant="secondary" className="border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">{status} · tidak berlaku</Badge>}
    {code && !inactive && <Button type="button" variant="ghost" size="icon-sm" aria-label={`Salin ${label.toLowerCase()}`} onClick={copy}><Copy className="size-4" /></Button>}
  </div>;
}
