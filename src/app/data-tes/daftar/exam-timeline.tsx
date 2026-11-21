"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ExamRunKind } from "@/lib/exam-session-types";
import { shiftTimelineDate, timelineLocal, timelineSegment, validTimelineDate } from "@/lib/exam-timeline.mjs";
import type { ExamTimeZone } from "@/lib/exam-test-types";

export type TimelineItem = {
  testId: string; runId: string | null; testName: string; periodName: string;
  kind: ExamRunKind | null; label: string | null; published: boolean;
  startUtc: string; timeZone: ExamTimeZone; durationMinutes: number;
};
export type TimelineClock = { WIB: string; WITA: string; WIT: string; now: string };
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const DAYS = 7, DAY_WIDTH = 576, LABEL_WIDTH = 230, PAGE_SIZE = 8;
const labels: Record<ExamRunKind, string> = { regular: "Reguler", makeup: "Susulan", remedial: "Remidi" };
const colors: Record<ExamRunKind | "base", string> = {
  regular: "bg-emerald-600 dark:bg-emerald-400",
  makeup: "bg-blue-600 dark:bg-blue-400",
  remedial: "bg-amber-600 dark:bg-amber-400",
  base: "bg-slate-500 dark:bg-slate-400",
};
const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const weekdays = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
function dateAt(start: string, offset: number) {
  return new Date(Date.parse(`${start}T00:00:00Z`) + offset * 86_400_000);
}
function dateLabel(date: Date) { return `${weekdays[date.getUTCDay()]}, ${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`; }
function niceLocal(value: string | null) { return value ? `${value.slice(8, 10)}/${value.slice(5, 7)} ${value.slice(11, 16)}` : "—"; }
function itemName(item: TimelineItem) { return item.kind ? `${labels[item.kind]} · ${item.label}` : "Rancangan dasar · belum berkategori"; }
function itemHref(item: TimelineItem) {
  return `/data-tes/daftar/${item.testId}${item.published ? "" : `?atur=${item.runId}`}#pelaksanaan-${item.runId}`;
}

function ItemTarget({ item, onEditBase, className, children, style, ready, bar = false }: {
  item: TimelineItem; onEditBase: (id: string) => void; className: string; children: ReactNode; style?: CSSProperties; ready: boolean; bar?: boolean;
}) {
  const label = `${item.testName} · ${itemName(item)} · ${item.runId ? item.published ? "dirilis" : "draf" : "atur rancangan"}`;
  const shared = { className, style, title: label, "aria-label": bar ? undefined : label, "aria-hidden": bar ? true as const : undefined, tabIndex: bar ? -1 : undefined };
  return item.runId ? <Link prefetch={false} href={itemHref(item)} {...shared}>{children}</Link>
    : <button type="button" disabled={!ready} onClick={() => onEditBase(item.testId)} {...shared}>{children}</button>;
}

export function ExamTimeline({ items, clock, onEditBase }: { items: TimelineItem[]; clock: TimelineClock; onEditBase: (id: string) => void }) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const clockAnchor = useRef<{ server: number; client: number } | null>(null);
  useEffect(() => { clockAnchor.current = { server: Date.parse(clock.now), client: Date.now() }; }, [clock.now]);
  const [date, setDate] = useState(clock.WIB); const [zone, setZone] = useState<ExamTimeZone>("WIB");
  const [selected, setSelected] = useState<ExamRunKind | "all">("all"); const [page, setPage] = useState(0);
  const previous = shiftTimelineDate(date, -DAYS), next = shiftTimelineDate(date, DAYS);
  const entries = useMemo(() => items.flatMap((item) => {
    const segment = timelineSegment(item.startUtc, item.durationMinutes, date, zone, DAYS);
    return segment ? [{ item, segment }] : [];
  }).sort((a, b) => Date.parse(a.item.startUtc) - Date.parse(b.item.startUtc) || a.item.testId.localeCompare(b.item.testId)), [items, date, zone]);
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE)); const currentPage = Math.min(page, pages - 1);
  const visible = entries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const nearest = items.filter((item) => Date.parse(item.startUtc) >= Date.parse(clock.now)).sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))[0]
    ?? [...items].sort((a, b) => Date.parse(b.startUtc) - Date.parse(a.startUtc))[0];
  const nearestDate = nearest && timelineLocal(nearest.startUtc, zone)?.slice(0, 10);
  function chooseDate(nextDate: string) { if (validTimelineDate(nextDate)) { setDate(nextDate); setPage(0); } }
  function chooseToday() {
    // Hitung dari jam server yang diterima saat halaman dimuat, agar tombol
    // tetap berganti hari saat halaman dibiarkan terbuka melewati tengah malam.
    const anchor = clockAnchor.current;
    const estimated = anchor && new Date(anchor.server + Math.max(0, Date.now() - anchor.client)).toISOString();
    const current = estimated && timelineLocal(estimated, zone)?.slice(0, 10);
    chooseDate(current || clock[zone]);
  }

  return <Card aria-label="Timeline tes" className="mb-6 min-w-0 gap-0 overflow-hidden rounded-[20px] py-0">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5 sm:px-6">
      <div><div className="flex items-center gap-2"><CalendarDays className="size-5 text-indigo-600 dark:text-indigo-300" /><h2 className="text-base font-bold">Timeline tes</h2></div>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Pelaksanaan draf dan dirilis ditampilkan per baris agar bentrok tetap terlihat. Rancangan tanpa pelaksanaan ditandai belum berkategori. Jam mengikuti zona tampilan; detail menyertakan zona asli.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <div><label htmlFor="timeline-zone" className="mb-1 block text-xs font-semibold">Zona tampilan</label><select id="timeline-zone" disabled={!ready} value={zone} onChange={(e) => { setZone(e.target.value as ExamTimeZone); setPage(0); }} className="h-9 rounded-lg border bg-background px-2 text-sm"><option>WIB</option><option>WITA</option><option>WIT</option></select></div>
        <div><label htmlFor="timeline-date" className="mb-1 block text-xs font-semibold">Mulai tanggal</label><input id="timeline-date" disabled={!ready} type="date" min="2000-01-01" max="2100-12-31" value={date} onChange={(e) => chooseDate(e.target.value)} className="h-9 max-w-[10rem] rounded-lg border bg-background px-2 text-sm" /></div>
        <Button type="button" size="sm" variant="outline" aria-label="Minggu sebelumnya" disabled={!ready || !previous} onClick={() => previous && chooseDate(previous)}><ChevronLeft className="size-4" /></Button>
        <Button type="button" size="sm" variant="outline" disabled={!ready} onClick={chooseToday}>Hari ini</Button>
        <Button type="button" size="sm" variant="outline" aria-label="Minggu berikutnya" disabled={!ready || !next} onClick={() => next && chooseDate(next)}><ChevronRight className="size-4" /></Button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 sm:px-6" aria-label="Sorot kategori">
      <span className="mr-1 text-xs font-semibold">Sorot kategori:</span>
      {(["all", "regular", "makeup", "remedial"] as const).map((kind) => <Button key={kind} type="button" size="sm" variant={selected === kind ? "default" : "outline"} aria-pressed={selected === kind} disabled={!ready} onClick={() => setSelected(kind)} className="h-8 rounded-full text-xs">{kind === "all" ? "Semua" : labels[kind]}</Button>)}
      <span className="text-[11px] text-muted-foreground">Kategori lain tetap tampil lebih redup.</span>
    </div>
    {visible.length ? <>
      <div role="region" aria-label="Garis waktu tes, geser mendatar untuk melihat tanggal dan jam" tabIndex={0} className="max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
        <div style={{ width: LABEL_WIDTH + DAYS * DAY_WIDTH }}>
          <div className="flex border-b bg-muted/70">
            <div className="sticky left-0 z-20 flex shrink-0 items-center border-r bg-muted px-4 text-xs font-bold" style={{ width: LABEL_WIDTH }}>Tes / pelaksanaan</div>
            {Array.from({ length: DAYS }, (_, day) => <div key={day} className="shrink-0 border-r" style={{ width: DAY_WIDTH }}>
              <div className="border-b px-2 py-2 text-xs font-bold">{dateLabel(dateAt(date, day))} · {zone}</div>
              <div aria-label={`Skala jam 00 sampai 24 ${zone}`} className="relative h-6 text-[10px] text-muted-foreground">{Array.from({ length: 25 }, (_, hour) => <span key={hour} className="absolute top-1 tabular-nums" style={{ left: hour * (DAY_WIDTH / 24), transform: hour === 0 ? undefined : hour === 24 ? "translateX(-100%)" : "translateX(-50%)" }}>{String(hour).padStart(2, "0")}</span>)}</div>
            </div>)}
          </div>
          <ul aria-label="Jadwal dalam rentang timeline">{visible.map(({ item, segment }) => {
            const key = item.kind ?? "base"; const dimmed = selected !== "all" && item.kind !== selected;
            const start = timelineLocal(item.startUtc, zone); const endUtc = new Date(Date.parse(item.startUtc) + item.durationMinutes * 60_000).toISOString();
            const end = timelineLocal(endUtc, zone); const originalStart = timelineLocal(item.startUtc, item.timeZone); const originalEnd = timelineLocal(endUtc, item.timeZone);
            const detail = `${niceLocal(start)}–${niceLocal(end)} ${zone}${zone === item.timeZone ? "" : ` · asli ${niceLocal(originalStart)}–${niceLocal(originalEnd)} ${item.timeZone}`}`;
            return <li key={`${item.testId}-${item.runId ?? "base"}`} data-testid="timeline-row" data-kind={key} data-dimmed={dimmed ? "true" : "false"} className={`flex min-h-[82px] border-b last:border-b-0 ${dimmed ? "opacity-60 saturate-0" : ""}`}>
              <div className="sticky left-0 z-10 flex shrink-0 items-center border-r bg-card px-3 py-2" style={{ width: LABEL_WIDTH }}>
                <ItemTarget item={item} onEditBase={onEditBase} ready={ready} className="min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="block truncate text-xs font-bold">{item.testName}</span><span className="mt-0.5 block truncate text-[11px] font-semibold">{itemName(item)}{item.runId ? item.published ? " · Dirilis" : " · Draf" : ""}</span><span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{detail}</span>
                </ItemTarget>
              </div>
              <div className="relative shrink-0" style={{ width: DAYS * DAY_WIDTH, backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px)", backgroundSize: `${DAY_WIDTH / 24}px 100%` }}>
                <ItemTarget item={item} onEditBase={onEditBase} ready={ready} bar className={`absolute top-1/2 h-7 -translate-y-1/2 rounded-md shadow-sm hover:brightness-110 ${colors[key]}`} style={{ left: segment.left * DAY_WIDTH / 1440, width: Math.max(3, segment.width * DAY_WIDTH / 1440) }}>
                  <span className="sr-only">{detail}</span>{segment.clippedStart && <span aria-hidden="true" className="absolute left-0 text-white">‹</span>}{segment.clippedEnd && <span aria-hidden="true" className="absolute right-0 text-white">›</span>}
                </ItemTarget>
              </div>
            </li>;
          })}</ul>
        </div>
      </div>
      <nav aria-label="Halaman timeline" className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs sm:px-6"><span>{entries.length} jadwal · halaman {currentPage + 1} dari {pages}</span><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={!ready || currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="size-4" /> Sebelumnya</Button><Button type="button" variant="outline" size="sm" disabled={!ready || currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Berikutnya <ChevronRight className="size-4" /></Button></div></nav>
    </> : <div className="px-5 py-8 text-center text-sm text-muted-foreground" role="status">Tidak ada jadwal pada rentang ini. {nearestDate && validTimelineDate(nearestDate) && <button type="button" disabled={!ready} className="font-semibold text-primary underline" onClick={() => chooseDate(nearestDate)}>Ke jadwal terdekat</button>}</div>}
  </Card>;
}
