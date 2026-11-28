import "server-only";

import { createReportWorkbook, type SpreadsheetCell, type SpreadsheetSheet } from "@/lib/report-xlsx.mjs";
import type { ReportFilters } from "@/lib/report-filter.mjs";
import type { ReportData } from "./report-data";

const kinds = { regular: "Reguler", makeup: "Susulan", remedial: "Remidi" } as const;
const method = { highest: "Tertinggi", average: "Rata-rata" } as const;
const columns = (items: Array<[string, number]>) => items.map(([title, width]) => ({ title, width }));

/** Tidak menyalin jawaban, soal, kunci, token, sandi atau data sesi. */
export function createReportXlsx(data: ReportData, filters: ReportFilters): Uint8Array {
  const summary: SpreadsheetSheet = {
    name: "Rekap",
    columns: columns([["Periode", 22], ["Tes (snapshot)", 28], ["Tag tes", 24], ["Nama peserta (snapshot)", 30], ["Nomor peserta (snapshot)", 24],
      ["NISN saat ini", 17], ["Kelas (snapshot cocok)", 22], ["Status nilai akhir", 20], ["Metode", 16],
      ["Nilai akhir", 15], ["Selesai seluruhnya", 20], ["Belum selesai", 17], [`Selesai cocok terakhir (${data.zone})`, 28], [`Ditetapkan (${data.zone})`, 26]]),
    rows: data.rows.map((r) => [r.period, r.testName, r.testTags.length ? r.testTags.join(", ") : "—", r.student, r.number, r.nisn, r.className,
      r.finalized ? "Ditetapkan" : "Sementara", method[r.method], { score: r.score }, r.attempts.length, r.unfinished, r.matchedAt, r.finalizedAt]),
  };
  const details: SpreadsheetCell[][] = [];
  for (const r of data.rows) for (const a of r.attempts) {
    details.push([r.period, a.testName, a.testTags.length ? a.testTags.join(", ") : "—", a.student, a.number, r.nisn, a.className, kinds[a.kind], a.label, a.attemptNumber,
      a.started, a.completed, data.zone, a.runZone, a.reason === "submitted" ? "Dikumpulkan" : "Waktu habis",
      a.answered, a.correct, a.questions, { score: a.score }, a.matches ? "Ya" : "Tidak"]);
  }
  const attempts: SpreadsheetSheet = {
    name: "Pengerjaan",
    columns: columns([["Periode", 22], ["Tes (snapshot)", 28], ["Tag tes", 24], ["Nama (snapshot)", 30], ["Nomor peserta (snapshot)", 24], ["NISN saat ini", 17],
      ["Kelas (snapshot)", 22], ["Kategori", 14], ["Pelaksanaan", 24], ["Pengerjaan ke-", 18], ["Mulai", 23], ["Selesai", 23],
      ["Zona waktu laporan", 20], ["Zona pelaksanaan", 19], ["Penyelesaian", 18], ["Terjawab", 13], ["Benar", 13], ["Jumlah soal", 15], ["Nilai pengerjaan", 18], ["Cocok seluruh filter", 23]]),
    rows: details,
  };
  const info: SpreadsheetSheet = {
    name: "Informasi",
    columns: columns([["Keterangan", 30], ["Isi", 60]]),
    rows: [
      ["Dibuat (UTC)", new Date().toISOString()], ["Zona waktu laporan", filters.zone],
      ["Periode", filters.periodId ? `ID ${filters.periodId}` : "Semua"], ["Tes", filters.testId ? `ID ${filters.testId}` : "Semua"],
      ["Kelas snapshot", filters.className ?? "Semua"], ["Pencarian siswa", filters.student ?? "Semua"],
      ["Dari (inklusif)", filters.fromLocal ? `${filters.fromLocal.replace('T', ' ')} ${filters.zone}` : "Tanpa batas"],
      ["Sampai (inklusif satu menit)", filters.toLocal ? `${filters.toLocal.replace('T', ' ')} ${filters.zone}` : "Tanpa batas"],
      ["Pasangan tes/peserta", data.total],
      ["Pencocokan", "Pasangan disertakan jika setidaknya satu pengerjaan selesai memenuhi seluruh filter pada pengerjaan yang sama."],
      ["Nilai akhir", "Dihitung dari seluruh pengerjaan selesai untuk tes/peserta itu, termasuk yang tidak cocok filter; bukan dari nilai yang sudah dibulatkan."],
      ["Rincian", "Lembar Pengerjaan memuat semua pengerjaan selesai penyumbang. Kolom Cocok seluruh filter menandai yang memenuhi filter."],
      ["Identitas", "Nama, nomor peserta, kelas, dan nama tes adalah snapshot saat mulai. NISN dan nama periode adalah data saat ini."],
      ["Status", "Sementara bukan nilai yang ditetapkan. Pengerjaan yang belum selesai tidak dihitung, tetapi jumlahnya ditampilkan."],
      ["Privasi", "Khusus admin; isi dapat memuat nilai yang belum dibagikan kepada peserta. Simpan dan bagikan dengan aman."],
    ],
  };
  return createReportWorkbook([summary, attempts, info]);
}
