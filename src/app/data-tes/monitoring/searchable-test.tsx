"use client";
import { useId, useState } from "react";
import type { MonitoringOption } from "./monitoring-data";

/** Datalist native mendukung pencarian keyboard tanpa mengirim nama sebagai ID. */
export function SearchableTest({ options, selectedId }: { options: MonitoringOption[]; selectedId: string | null }) {
  const listId = useId();
  const label = (t: MonitoringOption) => `${t.name} · ${t.period}${t.year ? ` · ${t.year}` : ""} [${t.id}]`;
  const selected = options.find((t) => t.id === selectedId);
  const [text, setText] = useState(selected ? label(selected) : selectedId ? `Tes tidak ditemukan [${selectedId}]` : "");
  const matched = options.find((t) => label(t) === text);
  const id = matched?.id ?? (!text ? "" : selectedId && text === `Tes tidak ditemukan [${selectedId}]` ? selectedId : "invalid");
  return <div><label htmlFor="monitor-test" className="mb-1 block text-xs font-semibold">Nama tes</label>
    <input id="monitor-test" list={listId} value={text} onChange={(e) => setText(e.target.value)} placeholder="Cari atau pilih tes" autoComplete="off" className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm" />
    <datalist id={listId}>{options.map((t) => <option key={t.id} value={label(t)} />)}</datalist>
    <input type="hidden" name="tes" value={id} />{text && !matched && id === "invalid" && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Pilih tes dari daftar, atau kosongkan untuk semua.</p>}
  </div>;
}
