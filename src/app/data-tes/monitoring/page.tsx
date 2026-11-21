import { Activity, ChevronLeft, ChevronRight, CircleAlert, Info, RefreshCw } from "lucide-react";
import Link from "next/link";
import type { PoolClient } from "pg";

import { ScoreVisibilityControl } from "@/app/data-tes/monitoring/score-visibility-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { gradeExamCounts } from "@/lib/exam-grading.mjs";
import { participantPageNumber } from "@/lib/participant-login-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";

export const metadata = { title: "Hasil / Monitoring Tes — NusaCBT", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;
type Row = { id: string; student: string; number: string; className: string; period: string; testName: string; label: string;
  kind: "regular" | "makeup" | "remedial"; questionCount: number; answered: number; correct: number | null;
  status: "working" | "waiting" | "submitted" | "time_expired"; started: string; deadline: string; zone: string };
type ScoreOption = { id: string; name: string; period: string; visible: boolean; revision: string };
type Data = { options: ScoreOption[]; rows: Row[]; total: number; page: number; pages: number };

async function loadData(testId: string | null, requestedPage: number): Promise<Data> {
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const options = (await client.query<ScoreOption>(
      `SELECT t.id::text AS id,t.name,p.name AS period,COALESCE(v.visible_to_participants,false) AS visible,
         COALESCE(v.revision,0)::text AS revision
       FROM exam_tests t JOIN exam_periods p ON p.id=t.period_id
       LEFT JOIN exam_score_visibility v ON v.exam_test_id=t.id
       ORDER BY p.start_date DESC,t.name,t.id`,
    )).rows;
    const total = (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM exam_attempts WHERE ($1::bigint IS NULL OR exam_test_id=$1::bigint)", [testId])).rows[0].count;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE)); const page = Math.min(requestedPage, pages);
    const rows = (await client.query<Row>(
      `SELECT a.id::text AS id,a.student_name_snapshot AS student,a.participant_number_snapshot AS number,
        a.class_name_snapshot AS "className",p.name AS period,a.test_name_snapshot AS "testName",a.run_label_snapshot AS label,
        a.kind,a.question_count AS "questionCount",COALESCE(a.answered_count,answers.answered,0)::int AS answered,a.correct_count AS correct,
        CASE WHEN a.completed_at IS NOT NULL THEN a.completion_reason
          WHEN a.deadline<=clock_timestamp() THEN 'waiting' ELSE 'working' END AS status,
        to_char(a.started_at AT TIME ZONE (CASE a.time_zone_snapshot WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END),'DD/MM/YYYY HH24:MI:SS') AS started,
        to_char(a.deadline AT TIME ZONE (CASE a.time_zone_snapshot WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END),'DD/MM/YYYY HH24:MI:SS') AS deadline,
        a.time_zone_snapshot AS zone
       FROM exam_attempts a JOIN exam_periods p ON p.id=a.period_id
       LEFT JOIN LATERAL (SELECT count(*)::int AS answered FROM exam_attempt_questions aq WHERE aq.attempt_id=a.id AND aq.answer IS NOT NULL) answers ON a.completed_at IS NULL
       WHERE ($1::bigint IS NULL OR a.exam_test_id=$1::bigint)
       ORDER BY a.started_at DESC,a.id DESC LIMIT $2::integer OFFSET $3::integer`, [testId, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    )).rows;
    await client.query("COMMIT");
    return { options, rows, total, page, pages };
  } catch (error) { if (client) await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client?.release(); }
}

function url(testId: string | null, page: number) {
  const params = new URLSearchParams(); if (testId) params.set("tes", testId); if (page > 1) params.set("halaman", String(page));
  const query = params.toString(); return `/data-tes/monitoring${query ? `?${query}` : ""}`;
}

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ tes?: string | string[]; halaman?: string | string[] }> }) {
  await requireAdmin();
  const params = await searchParams; const testId = params.tes === undefined || params.tes === "" ? null : validDataId(params.tes);
  if (params.tes && !testId) return <div className="p-8"><Alert variant="destructive"><AlertTitle>Filter tes tidak valid</AlertTitle><AlertDescription><Link href="/data-tes/monitoring" className="underline">Buka seluruh hasil</Link>.</AlertDescription></Alert></div>;
  let data: Data;
  try { data = await loadData(testId, participantPageNumber(params.halaman)); }
  catch { return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Hasil / Monitoring Tes</h1><Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Hasil belum dapat dimuat</AlertTitle><AlertDescription>Periksa PostgreSQL dan migrasi terbaru, lalu muat ulang.</AlertDescription></Alert></div>; }
  const selectedTest = data.options.find((item) => item.id === testId);
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><Activity className="size-5" /></span>
      <div><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Hasil / Monitoring Tes</h1><p className="mt-2 text-[13px] leading-6 text-muted-foreground">Status dan nilai dasar setiap pengerjaan peserta.</p></div></div>
      <Button asChild variant="outline" className="rounded-xl"><Link href={url(testId, data.page)} prefetch={false}><RefreshCw className="size-4" /> Muat ulang</Link></Button></div>
    <Alert className="mb-5 max-w-5xl rounded-2xl"><Info className="size-4" /><AlertTitle>Nilai pengerjaan, bukan nilai akhir</AlertTitle><AlertDescription className="text-xs leading-5">Nilai = 100 × benar ÷ jumlah soal; salah dan kosong nol, tanpa penalti. Tampilan dua desimal. Nilai tersembunyi secara default; pilih satu tes pada filter untuk mengatur tampil atau sembunyi bagi peserta yang sudah selesai. Izin ulang dan metode nilai akhir belum tersedia.</AlertDescription></Alert>
    <Card className="gap-0 overflow-hidden rounded-[20px] py-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b p-5"><div><h2 className="font-bold">Daftar pengerjaan <Badge variant="secondary">{data.total}</Badge></h2><p className="mt-1 text-xs text-muted-foreground">Pantau pengerjaan dan atur pembagian nilai per tes.</p></div>
        <form action="/data-tes/monitoring" className="flex flex-wrap items-end gap-2"><div><label htmlFor="filter-tes" className="mb-1 block text-xs font-semibold">Filter tes</label><select id="filter-tes" name="tes" defaultValue={testId ?? ""} className="h-9 max-w-[18rem] rounded-lg border bg-background px-2 text-sm"><option value="">Semua tes</option>{data.options.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.period}</option>)}</select></div><Button type="submit" variant="outline">Terapkan</Button></form></div>
      {selectedTest ? <div className="border-b p-5"><ScoreVisibilityControl key={`${selectedTest.id}-${selectedTest.revision}`} {...selectedTest} /></div>
        : testId ? <p role="alert" className="border-b p-5 text-sm text-destructive">Tes tidak ditemukan. Pilih tes lain.</p>
          : <p className="border-b px-5 py-3 text-xs text-muted-foreground">Pilih satu tes pada filter untuk mengatur visibilitas nilai peserta.</p>}
      {data.rows.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">Belum ada pengerjaan pada pilihan ini.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th scope="col" className="p-4">Peserta</th><th scope="col" className="p-4">Tes / pelaksanaan</th><th scope="col" className="p-4">Waktu server</th><th scope="col" className="p-4">Status</th><th scope="col" className="p-4">Terjawab</th><th scope="col" className="p-4">Benar</th><th scope="col" className="p-4">Nilai pengerjaan</th></tr></thead>
        <tbody>{data.rows.map((row) => { const grade = row.correct === null ? null : gradeExamCounts(row.correct, row.questionCount); return <tr key={row.id} className="border-t align-top"><td className="p-4"><p className="font-semibold">{row.student}</p><p className="mt-1 text-xs text-muted-foreground">{row.number} · {row.className}</p></td><td className="p-4"><p className="font-semibold">{row.testName}</p><p className="mt-1 text-xs text-muted-foreground">{row.period} · {row.kind === "regular" ? "Reguler" : row.kind === "makeup" ? "Susulan" : "Remidi"} · {row.label}</p></td><td className="p-4 text-xs leading-5 text-muted-foreground">Mulai {row.started}<br />Batas {row.deadline} {row.zone}</td><td className="p-4"><Badge variant={row.status === "working" ? "default" : "secondary"}>{row.status === "working" ? "Mengerjakan" : row.status === "waiting" ? "Menunggu penyelesaian" : row.status === "time_expired" ? "Waktu habis" : "Dikumpulkan"}</Badge></td><td className="p-4 tabular-nums">{row.answered} / {row.questionCount}</td><td className="p-4 tabular-nums">{row.correct ?? "—"}</td><td className="p-4 font-bold tabular-nums">{grade?.ok ? grade.display : "—"}</td></tr>; })}</tbody></table></div>}
      {data.pages > 1 && <nav aria-label="Halaman hasil" className="flex flex-wrap items-center justify-between gap-2 border-t p-5 text-xs"><span>Halaman {data.page} dari {data.pages}</span><div className="flex gap-2">{data.page > 1 && <Button asChild size="sm" variant="outline"><Link href={url(testId, data.page - 1)}><ChevronLeft className="size-4" /> Sebelumnya</Link></Button>}{data.page < data.pages && <Button asChild size="sm" variant="outline"><Link href={url(testId, data.page + 1)}>Berikutnya <ChevronRight className="size-4" /></Link></Button>}</div></nav>}
    </Card>
  </div>;
}
