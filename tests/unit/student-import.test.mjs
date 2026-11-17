import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { makeImportWorkbook } from "../helpers/import-workbook.mjs";
import { planStudentImport } from "../../src/lib/student-import-validation.mjs";
import { MAX_IMPORT_BYTES, readStudentWorkbook } from "../../src/lib/student-import-xlsx.mjs";

const classes = [{ id: "1", label: "X AK" }, { id: "2", label: "XI AK" }];
const oldStudent = { id: "11", name: "Siti Contoh", nisn: "0000000007", version: "2026-01-01T00:00:00.000001Z" };
const oldPlacement = { id: "21", studentId: "11", classId: "1", classNameSnapshot: "X AK" };

async function rows(cells, extra = {}) {
  return readStudentWorkbook(makeImportWorkbook({ rows: cells.map((row) => ({ cells: row })), ...extra }));
}

test("template yang disepakati dibaca dengan NISN nol di depan dan baris kosong diabaikan", async () => {
  const file = await readFile(new URL("../../public/templates/template-peserta-nusacbt.xlsx", import.meta.url));
  const parsed = await readStudentWorkbook(file);
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed.map((row) => row.cells[2].value), ["0000000001", "0000000002", "0000000003"]);
  assert.equal(parsed[0].cells[2].kind, "text");
});

test("workbook fiktif dari penulis XLSX terpisah mendukung shared string dan teks kaya", async () => {
  const file = await readFile(new URL("../fixtures/impor-fiktif-shared-strings.xlsx", import.meta.url));
  const parsed = await readStudentWorkbook(file);
  assert.deepEqual(parsed[0].cells.slice(0, 4), [
    { kind: "number", value: "1" },
    { kind: "text", value: "Siswa Fiktif" },
    { kind: "text", value: "0012345678" },
    { kind: "text", value: "X AK" },
  ]);
});

test("xlsx mendukung shared string, rich text dan escape Excel", async () => {
  const parsed = await rows([[1, { rich: ["Siswa ", "Cerah"] }, { rich: ["00000", "00004"] }, "X AK"], [2, "_x005F_x0041_", "0000000005", "X AK"]], { shared: true });
  assert.equal(parsed[0].cells[1].value, "Siswa Cerah");
  assert.equal(parsed[0].cells[2].value, "0000000004");
  assert.equal(parsed[1].cells[1].value, "_x0041_");
});

test("rencana memakai siswa lama tanpa menimpa, dan tidak mengubah penempatan yang sudah sesuai", async () => {
  const parsed = await rows([[1, "Siswa Baru", "0000000006", "x   ak"], [2, "Siti Contoh", "0000000007", "X AK"]]);
  const withoutPlacement = planStudentImport(parsed, classes, [oldStudent], []);
  assert.deepEqual(withoutPlacement.map((row) => row.status), ["siswa-baru", "penempatan-baru"]);
  const withPlacement = planStudentImport(parsed, classes, [oldStudent], [oldPlacement]);
  assert.deepEqual(withPlacement.map((row) => row.status), ["siswa-baru", "sudah-sesuai"]);
  assert.equal(withPlacement[1].student.id, "11");
  assert.equal(withPlacement[1].placement.id, "21");
});

test("nama dan kelas berbeda pada siswa lama menjadi konflik, bukan pembaruan", async () => {
  const parsed = await rows([[1, "Nama Berbeda", "0000000007", "XI AK"]]);
  const [plan] = planStudentImport(parsed, classes, [oldStudent], [oldPlacement]);
  assert.equal(plan.status, "masalah");
  assert.match(plan.issues.join(" "), /Nama berbeda/);
  assert.match(plan.issues.join(" "), /Kelas aktif/);
  assert.equal(plan.student.name, "Siti Contoh");
});

test("validasi menolak NISN duplikat, angka Excel, rumus, kelas asing dan nama kosong", async () => {
  const parsed = await readStudentWorkbook(makeImportWorkbook({ rows: [
    { cells: [1, "A", "0000000001", "X AK"] },
    { cells: [2, "B", "0000000001", "X AK"] },
    { cells: [3, "C", 1234567890, "X AK"] },
    { cells: [4, { formula: "B2" }, "0000000002", "X AK"] },
    { cells: [5, "D", "0000000003", "X Aneh"] },
    { cells: [6, null, "0000000004", "X AK"] },
    { hidden: true, cells: [7, "E", "0000000005", "X AK"] },
    { cells: [8, "F", "0000000006", "X AK", "Kolom tambahan"] },
    { cells: [9, "G", "12345678901", "X AK"] },
    { cells: [10, "_xD800_", "0000000012", "X AK"] },
  ] }));
  const plan = planStudentImport(parsed, classes, [], []);
  assert.ok(plan.every((row) => row.status === "masalah"));
  assert.match(plan[0].issues.join(), /lebih dari sekali/);
  assert.match(plan[1].issues.join(), /lebih dari sekali/);
  assert.match(plan[2].issues.join(), /teks di Excel/);
  assert.match(plan[3].issues.join(), /bukan rumus/);
  assert.match(plan[4].issues.join(), /Kelas tidak ditemukan/);
  assert.match(plan[5].issues.join(), /Nama harus diisi/);
  assert.match(plan[6].issues.join(), /tersembunyi/);
  assert.match(plan[7].issues.join(), /Kolom tambahan/);
  assert.match(plan[8].issues.join(), /tepat 10 digit/);
  assert.match(plan[9].issues.join(), /Unicode yang tidak valid/);
});

test("nama kelas yang ambigu tidak dipilih secara otomatis", async () => {
  const parsed = await rows([[1, "A", "0000000011", "X AK  JU"]]);
  const ambiguous = [{ id: "1", label: "X AK JU" }, { id: "2", label: "X AK  JU" }];
  const [plan] = planStudentImport(parsed, ambiguous, [], []);
  assert.equal(plan.status, "masalah");
  assert.match(plan.issues.join(), /tidak unik/);
});

test("header, sheet, sel gabungan dan baris melewati batas ditolak", async () => {
  await assert.rejects(readStudentWorkbook(makeImportWorkbook({ header: ["Nomor", "Nama", "NISN", "Rombel"] })), /Baris pertama/);
  await assert.rejects(readStudentWorkbook(makeImportWorkbook({ sheetName: "Sheet1" })), /Sheet bernama Peserta/);
  await assert.rejects(readStudentWorkbook(makeImportWorkbook({ sheetState: "hidden" })), /tersembunyi/);
  await assert.rejects(readStudentWorkbook(makeImportWorkbook({ merge: true })), /sel yang digabung/);
  await assert.rejects(readStudentWorkbook(makeImportWorkbook({ rows: [{ number: 1002, cells: [1, "X", "0000000001", "X AK"] }] })), /1.000 baris/);
  await assert.rejects(readStudentWorkbook(makeImportWorkbook({ rows: [{ cells: Array(17).fill("X") }] })), /16 kolom/);
});

test("header tersembunyi dan kolom tambahan pada header ditolak", async () => {
  await assert.rejects(readStudentWorkbook(makeImportWorkbook({ headerHidden: true })), /judul tersembunyi/);
  await assert.rejects(readStudentWorkbook(makeImportWorkbook({ header: ["Nomor", "Nama", "NISN", "Kelas", { formula: "1+1" }] })), /Kolom tambahan/);
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">
    <c r="A1" t="inlineStr"><is><t>Nomor</t></is></c><c r="B1" t="inlineStr"><is><t>Nama</t></is></c>
    <c r="C1" t="inlineStr"><is><t>NISN</t></is></c><c r="D1" t="inlineStr"><is><t>Kelas</t></is></c>
    <c r="E1" t="b"><v>1</v></c></row></sheetData></worksheet>`;
  await assert.rejects(readStudentWorkbook(makeImportWorkbook({ rawSheet: sheet })), /Kolom tambahan/);
});

test("menolak arsip rusak, terlalu besar, makro, DTD, dan data hasil dekompresi berlebihan", async () => {
  await assert.rejects(readStudentWorkbook(Buffer.from("not an xlsx")), /tidak valid|rusak/);
  await assert.rejects(readStudentWorkbook(Buffer.alloc(MAX_IMPORT_BYTES + 1)), /512 KB/);
  await assert.rejects(readStudentWorkbook(makeImportWorkbook({ extraEntries: { "xl/vbaProject.bin": "macro" } })), /makro/);
  await assert.rejects(readStudentWorkbook(makeImportWorkbook({ extraEntries: { "xl/large.xml": "A".repeat(4 * 1024 * 1024 + 1) } })), /terlalu besar/);
  const dtd = '<!DOCTYPE worksheet [<!ENTITY x "A">]><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>';
  await assert.rejects(readStudentWorkbook(makeImportWorkbook({ rawSheet: dtd })), /DTD/);
  const badCrc = makeImportWorkbook();
  const central = badCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central >= 0);
  badCrc.writeUInt32LE((badCrc.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
  await assert.rejects(readStudentWorkbook(badCrc), /rusak/);
});
