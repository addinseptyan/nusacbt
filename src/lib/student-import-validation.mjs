import { validateNisn, validateStudentName } from "./student-validation.mjs";

/** @typedef {{kind: string, value: string}} ImportCell */
/** @typedef {{rowNumber: number, hidden: boolean, cells: ImportCell[]}} WorkbookRow */
/** @typedef {{id: string, label: string}} ImportClass */
/** @typedef {{id: string, name: string, nisn: string, version: string}} ImportStudent */
/** @typedef {{id: string, studentId: string, classId: string, classNameSnapshot: string}} ImportPlacement */
/** @typedef {'siswa-baru'|'penempatan-baru'|'sudah-sesuai'|'masalah'} ImportStatus */
/** @typedef {{rowNumber: number, name: string, nisn: string, className: string, status: ImportStatus, issues: string[], schoolClass: ImportClass|null, student: ImportStudent|null, placement: ImportPlacement|null}} PlannedRow */

function classKey(value) {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

// Hanya untuk membandingkan; nama lama yang tersimpan tidak ditulis ulang.
function studentNameKey(value) {
  return value.trim().normalize("NFC").toUpperCase().normalize("NFC");
}

function nonEmptyCell(cell) {
  return cell.kind === "formula" || cell.kind === "other" || cell.value.trim() !== "";
}

function textCell(cell, label, issues) {
  if (cell.kind === "formula") {
    issues.push(`${label} harus berupa nilai teks, bukan rumus.`);
    return "";
  }
  if (cell.kind !== "text") {
    if (label === "NISN" && cell.kind === "number") {
      issues.push("NISN harus disimpan sebagai teks di Excel; nol yang hilang tidak dapat ditebak.");
    } else {
      issues.push(`${label} harus diisi sebagai teks.`);
    }
    return "";
  }
  if (!cell.value.trim()) {
    issues.push(`${label} wajib diisi.`);
    return "";
  }
  return cell.value;
}

/**
 * Tidak ada perubahan database pada tahap ini. Semua masalah ditampilkan sekaligus.
 * @param {WorkbookRow[]} rows
 * @param {ImportClass[]} classes
 * @param {ImportStudent[]} students
 * @param {ImportPlacement[]} placements
 * @returns {PlannedRow[]}
 */
export function planStudentImport(rows, classes, students, placements) {
  /** @type {Map<string, ImportClass[]>} */
  const classesByKey = new Map();
  for (const schoolClass of classes) {
    const key = classKey(schoolClass.label);
    const list = classesByKey.get(key) ?? [];
    list.push(schoolClass);
    classesByKey.set(key, list);
  }
  const classesById = new Map(classes.map((item) => [item.id, item]));
  const studentsByNisn = new Map(students.map((item) => [item.nisn, item]));
  const placementsByStudent = new Map(placements.map((item) => [item.studentId, item]));
  const nisnCounts = new Map();
  for (const row of rows) {
    const cell = row.cells[2];
    const parsed = cell?.kind === "text" ? validateNisn(cell.value) : null;
    if (parsed?.ok) nisnCounts.set(parsed.value, (nisnCounts.get(parsed.value) ?? 0) + 1);
  }

  return rows.map((row) => {
    /** @type {string[]} */
    const issues = [];
    if (row.hidden) issues.push("Baris tersembunyi; tampilkan kembali sebelum impor.");
    const nameText = textCell(row.cells[1], "Nama", issues);
    const nisnText = textCell(row.cells[2], "NISN", issues);
    const classText = textCell(row.cells[3], "Kelas", issues);
    const parsedName = validateStudentName(nameText);
    const parsedNisn = validateNisn(nisnText);
    const student = parsedNisn.ok ? (studentsByNisn.get(parsedNisn.value) ?? null) : null;
    const comparableName = nameText.trim();
    const validForComparison = Boolean(comparableName) && comparableName.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(comparableName);
    const sameName = Boolean(student && validForComparison && studentNameKey(student.name) === studentNameKey(comparableName));
    // Nama lama tidak disimpan ulang, sehingga tetap dapat dicocokkan walau
    // kapitalisasi Unicode memperpanjang hasilnya melewati batas nama baru.
    if (nameText && !parsedName.ok && !sameName) issues.push(parsedName.error);
    if (nameText && !nameText.isWellFormed()) issues.push("Nama mengandung karakter Unicode yang tidak valid.");
    if (nisnText && !parsedNisn.ok) issues.push(parsedNisn.error);
    const nisn = nisnText.trim();
    const className = classText.trim().replace(/\s+/gu, " ");
    if (row.cells.slice(4).some(nonEmptyCell)) issues.push("Kolom tambahan tidak didukung; gunakan empat kolom template.");
    if (parsedNisn.ok && (nisnCounts.get(parsedNisn.value) ?? 0) > 1) issues.push("NISN muncul lebih dari sekali di file.");

    /** @type {ImportClass|null} */
    let schoolClass = null;
    if (classText) {
      if (Array.from(classText).length > 100 || !classText.isWellFormed() || /[\u0000-\u001f\u007f]/.test(classText)) {
        issues.push("Kelas tidak valid atau terlalu panjang.");
      } else {
        const matches = classesByKey.get(classKey(classText)) ?? [];
        if (!matches.length) issues.push("Kelas tidak ditemukan. Buat kelas terlebih dahulu atau perbaiki nama kelas di Excel.");
        else if (matches.length > 1) issues.push("Nama kelas tidak unik setelah spasi dan huruf disamakan; periksa daftar kelas.");
        else schoolClass = matches[0];
      }
    }
    const placement = student ? (placementsByStudent.get(student.id) ?? null) : null;
    if (student && parsedName.ok && !sameName) {
      issues.push(`Nama berbeda dengan data siswa yang sudah ada (${student.name}). Periksa data sebelum melanjutkan.`);
    }
    // Pratinjau menampilkan nama yang benar-benar akan dipertahankan/disimpan.
    const name = sameName && student ? student.name : parsedName.ok ? parsedName.value : nameText.trim();
    if (schoolClass && placement && placement.classId !== schoolClass.id) {
      const activeName = classesById.get(placement.classId)?.label ?? placement.classNameSnapshot;
      issues.push(`Kelas aktif pada tahun ajaran ini adalah ${activeName}, berbeda dari Excel. Ubah penempatan secara manual atau perbaiki file.`);
    }
    /** @type {ImportStatus} */
    const status = issues.length ? "masalah" : !student ? "siswa-baru" : placement ? "sudah-sesuai" : "penempatan-baru";
    return { rowNumber: row.rowNumber, name, nisn, className, status, issues, schoolClass, student, placement };
  });
}
