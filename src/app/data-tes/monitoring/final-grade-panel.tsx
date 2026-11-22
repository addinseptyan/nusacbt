import Link from "next/link";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";

import { FinalGradeControl } from "@/app/data-tes/monitoring/final-grade-control";
import type { FinalGradeData } from "@/app/data-tes/monitoring/final-grade-data";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatFinalGrade } from "@/lib/exam-final-grade.mjs";

type Props = { test: { id: string; name: string; period: string }; data: FinalGradeData; attemptPage: number };
const kindName = (kind: "regular" | "makeup" | "remedial") => kind === "regular" ? "Reguler" : kind === "makeup" ? "Susulan" : "Remidi";
const methodName = (method: string) => method === "highest" ? "Tertinggi" : "Rata-rata";
function pageUrl(test: string, finalPage: number, attemptPage: number) {
  const params = new URLSearchParams({ tes: test });
  if (finalPage > 1) params.set("nilaiHalaman", String(finalPage));
  if (attemptPage > 1) params.set("halaman", String(attemptPage));
  return `/data-tes/monitoring?${params.toString()}#nilai-akhir`;
}

export function FinalGradePanel({ test, data, attemptPage }: Props) {
  return <Card id="nilai-akhir" className="mb-5 gap-0 overflow-hidden rounded-[20px] py-0">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5"><div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Tes dan peserta</p>
      <h2 className="mt-1 text-lg font-bold">Nilai akhir · {test.name}</h2><p className="mt-1 text-xs text-muted-foreground">{test.period} · {data.total} peserta memiliki pengerjaan</p>
      <p className="mt-3 text-sm">Metode tes: <strong>{methodName(data.method)}</strong>{data.methodRevision === "0" && <span className="text-xs text-muted-foreground"> (awal)</span>}</p>
    </div><FinalGradeControl mode="method" testId={test.id} testName={test.name} period={test.period} method={data.method} methodRevision={data.methodRevision} /></div>
    <Alert role="note" className="m-5 mb-0 max-w-5xl rounded-xl"><Info className="size-4" /><AlertTitle>Pilih dengan sengaja sebelum menetapkan</AlertTitle><AlertDescription className="text-xs leading-5">Semua pengerjaan selesai pada Reguler, Susulan, Remidi dan pengulangan dihitung per peserta. Rata-rata berbobot sama per pengerjaan; hasil akhir dibulatkan dua desimal. Penetapan ditolak selama ada pengerjaan belum selesai, termasuk yang menunggu penyelesaian otomatis. Nilai akhir hanya dibagikan jika semua kategori penyumbang dibuka.</AlertDescription></Alert>
    {!data.rows.length ? <p className="p-7 text-sm text-muted-foreground">Belum ada pengerjaan pada tes ini.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th scope="col" className="p-4">Peserta</th><th scope="col" className="p-4">Pengerjaan penyumbang</th><th scope="col" className="p-4">Nilai</th><th scope="col" className="p-4">Status / pembagian</th><th scope="col" className="p-4">Tindakan</th></tr></thead>
      <tbody>{data.rows.map((row) => <tr key={row.identityId} data-testid="final-grade-row" className="border-t align-top">
        <td className="p-4"><p className="font-semibold">{row.student}</p><p className="mt-1 text-xs text-muted-foreground">{row.number} · {row.className}</p></td>
        <td className="p-4"><p>{row.finished} selesai{row.unfinished > 0 && ` · ${row.unfinished} belum selesai`}</p><p className="mt-1 text-xs text-muted-foreground">{row.kinds.length ? row.kinds.map(kindName).join(", ") : "Belum ada penyumbang selesai"}</p>{row.pendingPermissions > 0 && <p className="mt-1 text-xs text-muted-foreground">{row.pendingPermissions} izin belum digunakan</p>}</td>
        <td className="p-4 font-bold tabular-nums">{row.score ?? "—"}</td>
        <td className="min-w-[190px] p-4"><Badge variant={row.finalized ? "default" : "secondary"}>{row.finalized ? "Ditetapkan" : "Sementara"}</Badge><p className="mt-1 text-xs leading-5 text-muted-foreground">{!row.finalized ? "Nilai akhir belum dibagikan." : row.hiddenKinds.length ? `Belum dibagikan: kategori ${row.hiddenKinds.map(kindName).join(", ")} ditutup.` : "Dapat dibagikan kepada peserta."}</p></td>
        <td className="p-4"><FinalGradeControl mode={row.finalized ? "reopen" : "finalize"} testId={test.id} testName={test.name} period={test.period}
          method={data.method} methodRevision={data.methodRevision} identityId={row.identityId} student={row.student} number={row.number} className={row.className}
          stateRevision={row.revision} digest={row.digest} score={row.score} finished={row.finished} unfinished={row.unfinished} pendingPermissions={row.pendingPermissions} />
          {!row.finalized && row.unfinished > 0 && <p className="mt-1 max-w-[190px] text-xs text-muted-foreground">Tunggu semua pengerjaan selesai.</p>}
          {!row.finalized && row.finished === 0 && <p className="mt-1 max-w-[190px] text-xs text-muted-foreground">Perlu setidaknya satu pengerjaan selesai.</p>}</td>
      </tr>)}</tbody></table></div>}
    {data.pages > 1 && <nav aria-label="Halaman nilai akhir" className="flex flex-wrap items-center justify-between gap-2 border-t p-5 text-xs"><span>Halaman {data.page} dari {data.pages}</span><div className="flex gap-2">{data.page > 1 && <Button asChild size="sm" variant="outline"><Link href={pageUrl(test.id, data.page - 1, attemptPage)}><ChevronLeft className="size-4" /> Sebelumnya</Link></Button>}{data.page < data.pages && <Button asChild size="sm" variant="outline"><Link href={pageUrl(test.id, data.page + 1, attemptPage)}>Berikutnya <ChevronRight className="size-4" /></Link></Button>}</div></nav>}
    <details className="border-t p-5 text-sm"><summary className="cursor-pointer font-semibold">Riwayat tindakan nilai akhir · 20 terbaru</summary>
      {!data.audit.length ? <p className="mt-3 text-xs text-muted-foreground">Belum ada tindakan nilai akhir.</p> : <ol className="mt-3 space-y-3">{data.audit.map((event, index) => <li key={`${event.time}-${index}`} className="rounded-lg border p-3 text-xs leading-5">
        <strong>{event.action === "method" ? `Metode: ${methodName(event.oldValue)} → ${methodName(event.newValue)}` : `${event.action === "finalize" ? "Ditetapkan" : "Dibuka kembali"}: ${event.student ?? "peserta"} · ${event.number ?? "—"}`}</strong>
        <p className="text-muted-foreground">{event.time} · {event.actor ?? "admin dihapus"}{event.recordedHundredths !== null && ` · ${formatFinalGrade(event.recordedHundredths / 100)} (${methodName(event.recordedMethod ?? "highest")}, ${event.recordedAttemptCount} pengerjaan)`}{event.action === "finalize" && ` · ${event.revoked} izin dicabut`}</p>
      </li>)}</ol>}
      <p className="mt-3 text-xs text-muted-foreground">Catatan tersimpan di database; daftar ini menunjukkan 20 tindakan terakhir. Nilai yang tercatat adalah nilai saat tindakan, bukan sumber perhitungan.</p>
    </details>
  </Card>;
}
