import "server-only";
import { gradeExamCounts } from "@/lib/exam-grading.mjs";
import type { MatrixFilters } from "@/lib/matrix-report-filter.mjs";
import { createReportWorkbook, type SpreadsheetCell, type SpreadsheetSheet } from "@/lib/report-xlsx.mjs";
import type { MatrixData } from "./matrix-data";

const kindNames = {regular:"Reguler",makeup:"Susulan",remedial:"Remidi"} as const;
const columns = (items:Array<[string,number]>) => items.map(([title,width]) => ({title,width}));
export function createMatrixWorkbook(data:MatrixData,f:MatrixFilters) {
  const year = data.options?.years.find((item) => item.id === f.yearId)?.name ?? (f.yearId ? `ID ${f.yearId}` : "Semua tahun");
  const period = data.options?.periods.find((item) => item.id === f.periodId)?.name ?? (f.periodId ? `ID ${f.periodId}` : "Semua periode");
  const type = f.merge ? "Reguler + Susulan" : kindNames[f.kind];
  const summary:SpreadsheetSheet = {name:"Rekap",columns:columns([["No",8],["Nama",30],["NISN",17],["Grup / kelas",25],["Rata-rata",16],...data.columns.map((c):[string,number] => [`${c.name}\n${c.period}`,24])]),
    ...(data.columns.length ? {matrixLayout:{firstTestColumn:5,groupTitle:"DAFTAR NAMA TES"}} : {}),
    preamble:[["REKAPITULASI HASIL TES"],["Grup",f.className ?? "Semua kelas"],["Tahun ajaran",year],["Periode",period],["Rentang waktu selesai",`${f.from ?? "tanpa batas"} — ${f.to ?? "tanpa batas"} (${f.zone})`],["Jenis ujian",type],["Jumlah tes",data.columns.length],["Keterangan","Biru = Susulan; Periksa = nilai Reguler dan Susulan sama-sama ada. Konflik tidak dihitung dalam rata-rata."]],
    rows:data.rows.map((r,index) => {
      const cells:SpreadsheetCell[] = data.columns.map((c) => { const value = r.cells[c.id];
        if (!value) return null; if (value.kind === "conflict") return {text:"Periksa",style:"conflict"};
        return value.score === null ? null : {score:value.score,...(value.kind === "makeup" ? {style:"makeup" as const} : {})};
      });
      return [index+1,r.name,r.nisn,`${r.year ?? "Tahun belum dipetakan"} · ${r.className}`,r.average === null ? null : {score:r.average},...cells];
    }),
  };
  const details:SpreadsheetSheet = {name:"Pengerjaan",columns:columns([["Nama",30],["NISN",17],["Kelas snapshot",22],["Tahun ajaran",18],["Periode",24],["Tes snapshot",28],["Kategori",15],["Selesai UTC",28],["Benar",10],["Jumlah soal",14],["Nilai pengerjaan",18],["Metode tes",16],["ID pengerjaan",18]]),
    rows:data.attemptRows.map((a) => { const score = gradeExamCounts(a.correct,a.questions); return [a.student,a.nisn,a.className,a.year,a.period,a.testName,kindNames[a.kind],a.completed,a.correct,a.questions,score.ok ? {score:score.hundredths/100} : null,a.method === "highest" ? "Tertinggi" : "Rata-rata",a.id]; }) };
  const info:SpreadsheetSheet = {name:"Informasi",columns:columns([["Keterangan",30],["Isi",60]]),rows:[
    ["Dibuat UTC",new Date().toISOString()],["Jumlah siswa",data.total],["Jumlah tes",data.columns.length],["Pengerjaan cocok",data.attempts],
    ["Waktu filter","Tanggal waktu selesai dalam zona yang dipilih; tanggal akhir inklusif."],
    ["Nilai sel","Metode tes diterapkan hanya pada pengerjaan selesai yang cocok dengan seluruh filter. Nilai ini dapat berbeda dari nilai akhir yang ditetapkan."],
    ["Gabung","Saat gabung, jika Reguler dan Susulan sama-sama cocok untuk siswa/tes, sel ditandai Periksa dan tidak dihitung sebagai angka."],
    ["Rata-rata","Rata-rata dari nilai sel yang tersedia, berbobot sama per tes; sel kosong dan bentrok tidak menjadi nol."],
    ["Identitas","Nama dan kelas dari snapshot cocok terbaru; NISN saat ini. Nama tes adalah snapshot cocok terbaru. Tahun/periode adalah data saat ini."],
    ["Privasi","Khusus admin. Nilai yang belum dibagikan dapat muncul; file tidak dienkripsi."]
  ]};
  return createReportWorkbook([summary,details,info]);
}
