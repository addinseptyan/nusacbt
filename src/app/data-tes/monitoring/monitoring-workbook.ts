import "server-only";
import { gradeExamCounts } from "@/lib/exam-grading.mjs";
import type { MonitoringFilters, MonitoringStatus } from "@/lib/monitoring-filter.mjs";
import { createReportWorkbook, type SpreadsheetSheet } from "@/lib/report-xlsx.mjs";
import type { MonitoringData } from "./monitoring-data";

export const statusLabels: Record<MonitoringStatus, string> = { not_started:"Belum mulai",working:"Mengerjakan",waiting:"Menunggu penyelesaian",submitted:"Dikumpulkan",time_expired:"Waktu habis" };
export const kindLabels = { regular:"Reguler",makeup:"Susulan",remedial:"Remidi" } as const;
export function durationLabel(seconds: number | null) {
  if (seconds === null) return "—";
  const n = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(n/3600)).padStart(2,"0")}:${String(Math.floor(n%3600/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}`;
}
export function monitoringWorkbook(data: MonitoringData, f: MonitoringFilters) {
  const columns = (values: Array<[string, number]>) => values.map(([title,width]) => ({ title,width }));
  const summary: SpreadsheetSheet = { name:"Monitoring",columns:columns([["No",8],["Waktu mulai",23],["Lama (JJ:MM:DD)",19],["Nama tes",30],["Kelas / rombel",22],["Nama peserta",30],["Nilai pengerjaan",19],["Status",25],["Kategori",15],["Periode",24],["Tahun ajaran",18],["Jadwal",23],["Pelaksanaan",25],["Rilis",14],["NISN",17],["Nomor peserta",20],["Pengerjaan ke-",18]]),
    rows:data.rows.map((r,i) => { const grade = r.correct !== null && r.questionCount ? gradeExamCounts(r.correct,r.questionCount) : null;
      return [i+1,r.started ? `${r.started} ${r.zone}` : null,r.elapsedSeconds === null ? null : durationLabel(r.elapsedSeconds),r.testName,r.className,r.student,
        grade?.ok ? {score:grade.hundredths/100} : null,statusLabels[r.status],kindLabels[r.kind],r.period,r.year,`${r.scheduled} ${r.zone}`,r.label,r.published ? "Dirilis" : "Draf",r.nisn,r.number,r.attemptNumber]; }) };
  const info: SpreadsheetSheet = { name:"Informasi",columns:columns([["Keterangan",26],["Isi",60]]),rows:[
    ["Dibuat UTC",new Date().toISOString()],["Zona",f.zone],["Rentang tanggal",`${f.from ?? "tanpa batas"} — ${f.to ?? "tanpa batas"}`],
    ["Tanggal filter","Berdasarkan waktu mulai jadwal pelaksanaan dalam zona laporan; batas tanggal akhir inklusif."],
    ["Waktu mengerjakan","JJ:MM:DD; untuk pengerjaan aktif dihitung hingga saat laporan dibuat, paling lama sampai deadline."],
    ["Baris","Setiap pengerjaan ditampilkan. Peserta terdaftar tanpa pengerjaan ditampilkan sebagai Belum mulai."],
    ["Privasi","Hanya untuk admin. File tidak dienkripsi; simpan dengan aman."]
  ] };
  return createReportWorkbook([summary,info]);
}
