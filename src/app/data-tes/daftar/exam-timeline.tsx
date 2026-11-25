"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { toast } from "sonner";

import { saveTimelineDefaultDays } from "@/app/data-tes/daftar/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ExamRunKind } from "@/lib/exam-session-types";
import { layoutTimelineDay, shiftTimelineDate, timelineLocal, timelineRangeLength, validTimelineDate } from "@/lib/exam-timeline.mjs";
import type { ExamTimeZone } from "@/lib/exam-test-types";

export type TimelineItem = {
  testId: string; runId: string | null; testName: string; periodName: string;
  kind: ExamRunKind | null; label: string | null; published: boolean;
  startUtc: string; timeZone: ExamTimeZone; durationMinutes: number;
};
export type TimelineClock = { WIB: string; WITA: string; WIT: string; now: string };
type DateRange = { start: string; end: string };
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const HEADER_HEIGHT = 52, MIN_DAY_HEIGHT = 124, LANE_HEIGHT = 44;
const labels: Record<ExamRunKind, string> = { regular: "Reguler", makeup: "Susulan", remedial: "Remidi" };
const colors: Record<ExamRunKind | "base", { card: string; line: string; dot: string }> = {
  regular: { card: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100", line: "bg-emerald-600 dark:bg-emerald-400", dot: "bg-emerald-600" },
  makeup: { card: "border-blue-300 bg-blue-50 text-blue-950 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100", line: "bg-blue-600 dark:bg-blue-400", dot: "bg-blue-600" },
  remedial: { card: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100", line: "bg-amber-600 dark:bg-amber-400", dot: "bg-amber-600" },
  base: { card: "border-slate-300 bg-slate-100 text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100", line: "bg-slate-500 dark:bg-slate-400", dot: "bg-slate-500" },
};
const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const weekdays = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const percent = (minutes: number) => `${minutes / 1440 * 100}%`;
const endFor = (start: string, length: number) => shiftTimelineDate(start, length - 1) ?? "2100-12-31";
function dateParts(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return { number: d.getUTCDate(), weekday: weekdays[d.getUTCDay()], month: months[d.getUTCMonth()], year: d.getUTCFullYear() };
}
function niceLocal(value: string | null) { return value ? `${value.slice(0, 10)} ${value.slice(11, 16)}` : "—"; }
function itemName(item: TimelineItem) { return item.runId ? item.label || "Pelaksanaan" : item.testName; }
function itemType(item: TimelineItem) { return item.kind ? `${labels[item.kind]} · ${item.published ? "Dirilis" : "Draf"}` : "Rancangan dasar · belum berkategori"; }
function itemHref(item: TimelineItem) {
  return `/data-tes/daftar/${item.testId}${item.published ? "" : `?atur=${item.runId}`}#pelaksanaan-${item.runId}`;
}
function itemTimes(item: TimelineItem, zone: ExamTimeZone) {
  const endUtc = new Date(Date.parse(item.startUtc) + item.durationMinutes * 60_000).toISOString();
  const start = timelineLocal(item.startUtc, zone), end = timelineLocal(endUtc, zone);
  const originalStart = timelineLocal(item.startUtc, item.timeZone), originalEnd = timelineLocal(endUtc, item.timeZone);
  return {
    short: start && end ? `${start.slice(11, 16)}–${end.slice(11, 16)} ${zone}` : "—",
    detail: `${niceLocal(start)}–${niceLocal(end)} ${zone}${zone === item.timeZone ? "" : ` · asli ${niceLocal(originalStart)}–${niceLocal(originalEnd)} ${item.timeZone}`}`,
  };
}

function ItemTarget({ item, onEditBase, ready, className, style, label, tooltip = false, children }: {
  item: TimelineItem; onEditBase: (id: string) => void; ready: boolean;
  className: string; style?: CSSProperties; label: string; tooltip?: boolean; children: ReactNode;
}) {
  const shared = { className, style, "aria-label": label };
  const target = item.runId ? <Link prefetch={false} href={itemHref(item)} {...shared}>{children}</Link>
    : <button type="button" disabled={!ready} onClick={() => onEditBase(item.testId)} {...shared}>{children}</button>;
  // Kartu dapat terpotong di layar kecil. Tooltip menampilkan teks penuh saat
  // hover/fokus, sedangkan daftar lengkap di bawah tersedia untuk layar sentuh.
  return tooltip ? <Tooltip><TooltipTrigger asChild>{target}</TooltipTrigger><TooltipContent sideOffset={6} className="max-w-[min(22rem,calc(100vw-2rem))] break-words">{label}</TooltipContent></Tooltip> : target;
}

export function ExamTimeline({ items, clock, defaultDays = 7, onEditBase }: { items: TimelineItem[]; clock: TimelineClock; defaultDays?: number; onEditBase: (id: string) => void }) {
  const router = useRouter();
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const initialDays = Number.isInteger(defaultDays) && defaultDays >= 1 && defaultDays <= 7 ? defaultDays : 7;
  const [maxDays, setMaxDays] = useState<number>(initialDays);
  const [savingMaxDays, startSavingMaxDays] = useTransition();
  const [range, setRange] = useState<DateRange>(() => ({ start: clock.WIB, end: endFor(clock.WIB, initialDays) }));
  const [draft, setDraft] = useState<DateRange>(range);
  const [zone, setZone] = useState<ExamTimeZone>("WIB");
  const [selected, setSelected] = useState<ExamRunKind | "all">("all");
  const [hourWidth, setHourWidth] = useState(48);
  const [horizontalScrollbarHeight, setHorizontalScrollbarHeight] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.parse(clock.now));
  const clockAnchor = useRef<{ server: number; client: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const dateHeader = useRef<HTMLDivElement>(null);
  const lastScale = useRef(0);

  useEffect(() => {
    clockAnchor.current = { server: Date.parse(clock.now), client: Date.now() };
    const tick = () => {
      const anchor = clockAnchor.current;
      if (anchor) setNowMs(anchor.server + Math.max(0, Date.now() - anchor.client));
    };
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [clock.now]);

  useEffect(() => {
    const element = scroll.current, header = dateHeader.current;
    if (!element || !header) return;
    const resize = () => {
      // Lebar sumbu 24 jam = dua kali area jam yang terlihat. Awalnya
      // pergeseran enam jam memperlihatkan pukul 06:00–18:00.
      const next = Math.max(1, (element.clientWidth - header.getBoundingClientRect().width) / 12);
      const firstVisibleHour = lastScale.current ? element.scrollLeft / lastScale.current : 6;
      lastScale.current = next;
      element.scrollLeft = firstVisibleHour * next;
      setHourWidth((previous) => Math.abs(previous - next) < 0.01 ? previous : next);
      // Scrollbar non-overlay (misalnya di Windows) tidak boleh memotong
      // bagian bawah tanggal ketiga.
      setHorizontalScrollbarHeight(element.offsetHeight - element.clientHeight);
    };
    const frame = window.requestAnimationFrame(resize);
    const observer = new ResizeObserver(resize); observer.observe(element); observer.observe(header);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  const count = timelineRangeLength(range.start, range.end, maxDays) ?? 1;
  const draftCount = timelineRangeLength(draft.start, draft.end, maxDays);
  const days = useMemo(() => Array.from({ length: count }, (_, index) => {
    const date = shiftTimelineDate(range.start, index)!;
    const events = layoutTimelineDay(items, date, zone, hourWidth);
    const lanes = events.reduce((maximum, event) => Math.max(maximum, event.lane + 1), 0);
    return { date, events, height: Math.max(MIN_DAY_HEIGHT, 18 + lanes * LANE_HEIGHT) };
  }), [count, hourWidth, items, range.start, zone]);
  // Tinggi mengikuti tiga tanggal pertama, termasuk lajur tambahan jika
  // jadwal bertumpuk. Batasi juga tinggi layar agar banyak jadwal yang
  // berimpit tidak membuat halaman sangat panjang.
  const viewportHeight = HEADER_HEIGHT + days.slice(0, 3).reduce((height, day) => height + day.height, 0) + horizontalScrollbarHeight;
  const previous = shiftTimelineDate(range.start, -count), next = shiftTimelineDate(range.start, count);
  const previousEnd = shiftTimelineDate(range.end, -count), nextEnd = shiftTimelineDate(range.end, count);
  const nowLocal = timelineLocal(new Date(nowMs).toISOString(), zone);
  const today = nowLocal?.slice(0, 10);
  const nowMinutes = nowLocal ? Number(nowLocal.slice(11, 13)) * 60 + Number(nowLocal.slice(14, 16)) : 0;
  const total = days.reduce((number, day) => number + day.events.length, 0);
  const nearest = items.filter((item) => Date.parse(item.startUtc) >= nowMs).sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))[0]
    ?? [...items].sort((a, b) => Date.parse(b.startUtc) - Date.parse(a.startUtc))[0];
  const nearestDate = nearest && timelineLocal(nearest.startUtc, zone)?.slice(0, 10);

  function chooseRange(nextRange: DateRange) {
    if (!timelineRangeLength(nextRange.start, nextRange.end, maxDays)) return;
    setRange(nextRange); setDraft(nextRange);
    if (scroll.current) scroll.current.scrollTop = 0;
  }
  function handleMaxDaysChange(nextDays: number) {
    if (!Number.isInteger(nextDays) || nextDays < 1 || nextDays > 7) return;
    setMaxDays(nextDays);
    const nextRange = { start: range.start, end: endFor(range.start, nextDays) };
    setRange(nextRange);
    setDraft(nextRange);
    if (scroll.current) scroll.current.scrollTop = 0;
    startSavingMaxDays(async () => {
      try {
        const result = await saveTimelineDefaultDays(nextDays);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(result.message);
        router.refresh();
      } catch {
        toast.error("Pengaturan maksimal hari timeline belum dapat disimpan.");
      }
    });
  }
  function chooseToday() {
    const anchor = clockAnchor.current;
    const estimated = anchor && new Date(anchor.server + Math.max(0, Date.now() - anchor.client)).toISOString();
    const current = (estimated && timelineLocal(estimated, zone)?.slice(0, 10)) || clock[zone];
    if (validTimelineDate(current)) chooseRange({ start: current, end: endFor(current, count) });
  }

  return <Card aria-label="Timeline tes" className="relative z-0 isolate mb-6 min-w-0 gap-0 overflow-hidden rounded-[20px] py-0">
    <div className="flex flex-wrap items-start justify-between gap-5 border-b p-5 sm:px-6">
      <div className="min-w-0"><div className="flex items-center gap-2"><span className="flex size-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300"><CalendarDays className="size-4" /></span><div><p className="text-[10px] font-bold tracking-[0.12em] text-indigo-600 uppercase dark:text-indigo-300">Jadwal pelaksanaan</p><h2 className="text-base font-bold">Timeline tes</h2></div></div>
        <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">Lihat jadwal per hari. Draf, jadwal dirilis, dan rancangan yang belum memiliki pelaksanaan tetap ditampilkan.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <div><label htmlFor="timeline-zone" className="mb-1 block text-xs font-semibold">Zona tampilan</label><select id="timeline-zone" disabled={!ready} value={zone} onChange={(event) => setZone(event.target.value as ExamTimeZone)} className="h-9 rounded-lg border bg-background px-2 text-sm"><option>WIB</option><option>WITA</option><option>WIT</option></select></div>
        <div><label htmlFor="timeline-max-days" className="mb-1 block text-xs font-semibold">Maksimal hari</label><select id="timeline-max-days" aria-label="Maksimal hari timeline" disabled={!ready || savingMaxDays} value={maxDays} onChange={(event) => handleMaxDaysChange(Number(event.target.value))} className="h-9 rounded-lg border bg-background px-2 text-sm">{[1, 2, 3, 4, 5, 6, 7].map((daysOption) => <option key={daysOption} value={daysOption}>{daysOption} hari</option>)}</select></div>
        <fieldset className="min-w-0"><legend className="mb-1 text-xs font-semibold">Rentang tanggal · maksimal {maxDays} hari</legend><div className="flex flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor="timeline-from">Tanggal mulai</label><input id="timeline-from" type="date" disabled={!ready} min="2000-01-01" max="2100-12-31" value={draft.start} onChange={(event) => setDraft((value) => ({ ...value, start: event.target.value }))} aria-invalid={draftCount === null} aria-describedby={draftCount === null ? "timeline-range-error" : undefined} className="h-9 max-w-[9.5rem] min-w-0 rounded-lg border bg-background px-2 text-xs sm:text-sm" />
          <span aria-hidden="true" className="text-xs text-muted-foreground">–</span>
          <label className="sr-only" htmlFor="timeline-to">Tanggal akhir</label><input id="timeline-to" type="date" disabled={!ready} min="2000-01-01" max="2100-12-31" value={draft.end} onChange={(event) => setDraft((value) => ({ ...value, end: event.target.value }))} aria-invalid={draftCount === null} aria-describedby={draftCount === null ? "timeline-range-error" : undefined} className="h-9 max-w-[9.5rem] min-w-0 rounded-lg border bg-background px-2 text-xs sm:text-sm" />
          <Button type="button" size="sm" variant="outline" disabled={!ready || draftCount === null} onClick={() => chooseRange(draft)}>Terapkan rentang</Button>
        </div></fieldset>
        <div className="flex gap-1"><Button type="button" size="sm" variant="outline" aria-label="Rentang sebelumnya" disabled={!ready || !previous || !previousEnd} onClick={() => previous && previousEnd && chooseRange({ start: previous, end: previousEnd })}><ChevronLeft className="size-4" /></Button>
          <Button type="button" size="sm" variant="outline" disabled={!ready} onClick={chooseToday}>Hari ini</Button>
          <Button type="button" size="sm" variant="outline" aria-label="Rentang berikutnya" disabled={!ready || !next || !nextEnd} onClick={() => next && nextEnd && chooseRange({ start: next, end: nextEnd })}><ChevronRight className="size-4" /></Button></div>
        {draftCount === null && <p id="timeline-range-error" role="alert" className="w-full text-xs text-destructive">Pilih tanggal awal dan akhir yang valid, dengan rentang 1–{maxDays} hari.</p>}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 sm:px-6" aria-label="Sorot kategori">
      <span className="mr-1 text-xs font-semibold">Sorot kategori:</span>
      {(["all", "regular", "makeup", "remedial"] as const).map((kind) => <Button key={kind} type="button" size="sm" variant={selected === kind ? "default" : "outline"} aria-pressed={selected === kind} disabled={!ready} onClick={() => setSelected(kind)} className="h-8 rounded-full text-xs">{kind === "all" ? "Semua" : labels[kind]}</Button>)}
      <span className="text-[11px] text-muted-foreground">Kategori lain tetap terlihat lebih redup.</span>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/25 px-5 py-3 text-[11px] text-muted-foreground sm:px-6">
      <div className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Keterangan kategori">{(["regular", "makeup", "remedial", "base"] as const).map((kind) => <span key={kind} className="inline-flex items-center gap-1.5"><i aria-hidden="true" className={`size-2 rounded-full ${colors[kind].dot}`} />{kind === "base" ? "Belum berkategori" : labels[kind]}</span>)}</div>
      <span className="inline-flex items-center gap-1.5"><ArrowLeftRight className="size-3.5" /> Geser untuk jam lain · gulir untuk tanggal lain</span>
    </div>
    {total === 0 && <div role="status" className="border-b px-5 py-2 text-xs text-muted-foreground sm:px-6">Tidak ada jadwal pada rentang ini. {nearestDate && validTimelineDate(nearestDate) && <button type="button" disabled={!ready} className="font-semibold text-primary underline" onClick={() => chooseRange({ start: nearestDate, end: endFor(nearestDate, count) })}>Ke jadwal terdekat</button>}</div>}
    <div ref={scroll} role="region" aria-label="Garis waktu tes, gulir untuk tanggal dan geser mendatar untuk jam" tabIndex={0} data-testid="timeline-viewport"
      className="max-w-full overflow-auto [--date-col-width:110px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:[--date-col-width:170px]" style={{ height: viewportHeight, maxHeight: "min(80dvh, 48rem)" }}>
      <div style={{ width: "calc(200% - var(--date-col-width))" }}>
        <div className="sticky top-0 z-30 flex border-b border-indigo-100 bg-[#f1f5fe] dark:border-slate-700 dark:bg-slate-900" style={{ height: HEADER_HEIGHT }}>
          <div ref={dateHeader} className="sticky left-0 z-40 flex w-[var(--date-col-width)] shrink-0 items-center justify-between gap-2 border-r border-indigo-100 bg-[#e7efff] px-3 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"><span>Hari &amp; tanggal</span><span className="hidden whitespace-nowrap text-[10px] font-medium text-slate-500 sm:inline dark:text-slate-300">{count} HARI</span></div>
          <div aria-label={`Skala jam 00 sampai 24 ${zone}`} className="relative min-w-0 flex-1 text-[10px] font-semibold text-slate-500 dark:text-slate-300">
            {Array.from({ length: 25 }, (_, hour) => {
              const mobile = hour % 3 === 0, desktop = hour % 2 === 0;
              if (!mobile && !desktop) return null;
              // Pada layar kecil label tiap tiga jam mencegah tumpang tindih.
              // Label pada 06 dan 18 diarahkan ke dalam viewport awal.
              const alignment = hour === 0 || hour === 6 ? "translateY(-50%)" : hour === 18 || hour === 24 ? "translate(-100%, -50%)" : "translate(-50%, -50%)";
              return <span key={hour} className={`absolute top-1/2 whitespace-nowrap tabular-nums ${mobile ? "block" : "hidden"} ${desktop ? "sm:block" : "sm:hidden"}`} style={{ left: `${hour / 24 * 100}%`, transform: alignment }}>{String(hour).padStart(2, "0")}:00</span>;
            })}
          </div>
        </div>
        <div aria-label="Jadwal dalam rentang timeline">{days.map((day, index) => {
          const date = dateParts(day.date); const isToday = day.date === today;
          return <section key={day.date} data-testid="timeline-day" data-date={day.date} aria-label={`${date.weekday}, ${date.number} ${date.month} ${date.year}`} className="flex border-b last:border-b-0" style={{ height: day.height }}>
            <div className="sticky left-0 z-20 flex w-[var(--date-col-width)] shrink-0 flex-col justify-center gap-2 border-r bg-card px-3 py-3 sm:px-4">
              <div className="flex items-start gap-2"><span className={`text-lg leading-none font-bold tabular-nums ${isToday ? "text-indigo-600 dark:text-indigo-300" : ""}`}>{date.number}</span><div className="min-w-0"><p className="text-xs font-bold">{date.weekday}</p><p className="text-[10px] leading-4 text-muted-foreground">{date.month} {date.year}</p></div></div>
              <div className="flex flex-wrap gap-1"><span className="w-fit rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">{day.events.length ? `${day.events.length} jadwal` : "Kosong"}</span>{isToday && <span className="w-fit rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white">Hari ini</span>}</div>
            </div>
            <div className={`relative min-w-0 flex-1 ${index % 2 ? "bg-[#fafbfe] dark:bg-slate-900/20" : "bg-[#f6f8fe] dark:bg-slate-900/35"}`} style={{ backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px)", backgroundSize: "4.1666667% 100%" }}>
              {isToday && <div aria-hidden="true" data-testid="timeline-now" className="pointer-events-none absolute inset-y-0 z-[5] w-px bg-red-500" style={{ left: percent(nowMinutes) }}><span className="absolute -left-1 top-0 size-2 rounded-full bg-red-500" /><span className="absolute bottom-1 left-1 rounded bg-card px-1 text-[9px] font-bold text-red-600 dark:text-red-300">{nowLocal?.slice(11, 16)}</span></div>}
              {day.events.length === 0 && <div className="sticky left-[var(--date-col-width)] flex h-full w-[min(100%,25rem)] items-center justify-center px-3 text-center text-[11px] italic text-muted-foreground">Tidak ada jadwal pada hari ini</div>}
              {day.events.map(({ item, segment, labelLeft, labelWidth, lane }) => {
                const kind = item.kind ?? "base"; const dimmed = selected !== "all" && item.kind !== selected;
                const times = itemTimes(item, zone);
                const description = `${itemName(item)}${item.runId ? ` · ${item.testName}` : ""} · ${item.periodName} · ${itemType(item)} · ${times.detail}`;
                return <div key={`${item.testId}-${item.runId ?? "base"}`} data-testid="timeline-event" data-kind={kind} data-dimmed={dimmed ? "true" : "false"} data-lane={lane} data-clipped-start={String(segment.clippedStart)} data-clipped-end={String(segment.clippedEnd)}
                  className={`pointer-events-none absolute inset-x-0 ${dimmed ? "opacity-65 grayscale" : ""}`} style={{ top: 9 + lane * LANE_HEIGHT, height: LANE_HEIGHT }}>
                  <ItemTarget item={item} onEditBase={onEditBase} ready={ready} label={description} tooltip style={{ left: percent(labelLeft), width: percent(labelWidth) }}
                    className={`pointer-events-auto absolute top-0 flex h-9 min-w-0 flex-col justify-center overflow-hidden rounded-lg border px-2 text-left shadow-sm transition hover:brightness-95 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${colors[kind].card} ${item.runId && !item.published ? "border-dashed" : ""}`}>
                    <span className="flex w-full items-center gap-1 text-[11px] leading-4 font-bold">{segment.clippedStart && <span aria-hidden="true">←</span>}<span className="min-w-0 flex-1 truncate">{itemName(item)}{item.runId ? ` · ${item.testName}` : ""}</span>{segment.clippedEnd && <span aria-hidden="true">→</span>}</span>
                    <span className="block w-full truncate text-[10px] leading-3">{itemType(item)} · {times.short}</span>
                  </ItemTarget>
                  <span aria-hidden="true" data-testid="timeline-duration" className={`absolute top-[38px] h-[3px] rounded-full ${colors[kind].line}`} style={{ left: percent(segment.left), width: percent(segment.width) }} />
                </div>;
              })}
            </div>
          </section>;
        })}</div>
      </div>
    </div>
    {total > 0 && <details className="border-t px-5 py-3 sm:px-6"><summary className="w-fit cursor-pointer rounded-sm text-xs font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Lihat daftar lengkap jadwal</summary>
      <div className="mt-3 space-y-4" aria-label="Daftar lengkap jadwal per hari">{days.filter((day) => day.events.length > 0).map((day) => {
        const date = dateParts(day.date);
        return <div key={day.date}><h3 className="mb-1.5 text-xs font-bold">{date.weekday}, {date.number} {date.month} {date.year}</h3><ul className="space-y-1.5">{day.events.map(({ item }) => {
          const description = `${itemName(item)}${item.runId ? ` · ${item.testName}` : ""} · ${item.periodName} · ${itemType(item)} · ${itemTimes(item, zone).detail}`;
          return <li key={`${item.testId}-${item.runId ?? "base"}`}><ItemTarget item={item} onEditBase={onEditBase} ready={ready} label={description} className="block max-w-full break-words rounded-md text-left text-xs leading-5 text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{description}</ItemTarget></li>;
        })}</ul></div>;
      })}</div>
    </details>}
    <noscript><p className="border-t px-5 py-3 text-xs text-muted-foreground sm:px-6">Pengaturan rentang dan zona memerlukan JavaScript. Gunakan daftar lengkap jadwal untuk membaca detail.</p></noscript>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-[11px] leading-5 text-muted-foreground sm:px-6"><span><Clock3 className="mr-1 inline size-3.5 align-[-2px]" />Garis warna menunjukkan durasi sebenarnya; kartu singkat dapat melebar agar terbaca.</span><span>Zona {zone}{days.some((day) => day.date === today) ? ` · garis merah: perkiraan ${nowLocal?.slice(11, 16)}` : ""} · panah menandai jadwal berlanjut.</span></div>
  </Card>;
}
