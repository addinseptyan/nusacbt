"use client";
import { useState } from "react";
import type { MonitoringKind } from "@/lib/monitoring-filter.mjs";

export function MatrixKindFilter({ initialKind, initialMerge }: { initialKind:MonitoringKind; initialMerge:boolean }) {
  const [kind,setKind] = useState<MonitoringKind>(initialKind); const [merge,setMerge] = useState(initialMerge);
  return <><div><label htmlFor="matrix-kind" className="mb-1 block text-xs font-semibold">Jenis ujian</label><select id="matrix-kind" name="kategori" value={kind} onChange={(e) => { const next=e.target.value as MonitoringKind; setKind(next); if(next!=="regular") setMerge(false); }} className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm"><option value="regular">Reguler</option><option value="makeup">Susulan</option><option value="remedial">Remidi</option></select></div>
    <label className="flex min-h-10 items-center gap-2 rounded-lg border border-input px-3 text-xs font-semibold"><input type="checkbox" name="gabung" value="1" checked={merge} disabled={kind!=="regular"} onChange={(e) => setMerge(e.target.checked)} className="size-4 accent-primary" /> Gabungkan nilai Reguler + Susulan</label></>;
}
