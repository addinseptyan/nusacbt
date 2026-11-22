import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import { validDataId } from "@/lib/class-validation.mjs";
import { lockAcademicMutation, syncYearPlacements } from "@/lib/academic-year-service";
import { lockActiveAdminSession } from "@/lib/admin-auth";
import { getPostgresPool } from "@/lib/postgres";
import { planStudentImport } from "@/lib/student-import-validation.mjs";
import { ImportFileError, MAX_IMPORT_BYTES, readStudentWorkbook } from "@/lib/student-import-xlsx.mjs";
import type { ImportCounts, ImportPreview, ImportPreviewRow } from "@/lib/student-import-types";
import { validateNisn } from "@/lib/student-validation.mjs";

type WorkbookRow = Awaited<ReturnType<typeof readStudentWorkbook>>[number];
type PlannedRow = ReturnType<typeof planStudentImport>[number];
type Period = { id: string; name: string; startDate: string; version: string };
type SchoolClass = { id: string; label: string };
type ExistingStudent = { id: string; name: string; nisn: string; version: string };
type Placement = { id: string; studentId: string; classId: string; classNameSnapshot: string; status: "active" | "graduated" | "left" };
type Upload = { periodId: string; rows: WorkbookRow[]; hash: string };
type Plan = { period: Period; rows: PlannedRow[]; counts: ImportCounts; token: string | null };

class ImportProblem extends Error {}

async function readUpload(formData: FormData): Promise<Upload> {
  const periodId = validDataId(formData.get("periodId"));
  if (!periodId) throw new ImportProblem("Pilih tahun ajaran yang valid terlebih dahulu.");
  const input = formData.get("file");
  if (!(input instanceof File) || !input.name.toLowerCase().endsWith(".xlsx")) {
    throw new ImportProblem("Pilih file Excel .xlsx dari template NusaCBT.");
  }
  if (!input.size || input.size > MAX_IMPORT_BYTES) throw new ImportProblem("Ukuran file harus lebih dari 0 dan maksimal 512 KB.");
  const bytes = Buffer.from(await input.arrayBuffer());
  const rows = await readStudentWorkbook(bytes);
  if (!rows.length) throw new ImportProblem("Sheet Peserta tidak berisi data. Isi Nama, NISN, dan Kelas terlebih dahulu.");
  return { periodId, rows, hash: createHash("sha256").update(bytes).digest("hex") };
}

function summarize(rows: PlannedRow[]): ImportCounts {
  return {
    rows: rows.length,
    newStudents: rows.filter((row) => row.status === "siswa-baru").length,
    newPlacements: rows.filter((row) => row.status === "siswa-baru" || row.status === "penempatan-baru").length,
    unchanged: rows.filter((row) => row.status === "sudah-sesuai").length,
    problems: rows.filter((row) => row.status === "masalah").length,
  };
}

async function makePlan(client: PoolClient, upload: Upload, adminId: string, lock: boolean): Promise<Plan> {
  const nisns = [...new Set(upload.rows.flatMap((row) => {
    const cell = row.cells[2];
    const result = cell.kind === "text" ? validateNisn(cell.value) : null;
    return result?.ok ? [result.value] : [];
  }))];
  // Sama dengan urutan penguncian penempatan manual: siswa, periode, kelas, lalu penempatan.
  const students = await client.query<ExistingStudent>(
    `SELECT id::text AS id, name, nisn,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
     FROM school_students WHERE nisn = ANY($1::text[]) ORDER BY id ${lock ? "FOR UPDATE" : ""}`,
    [nisns],
  );
  const periods = await client.query<Period>(
    `SELECT id::text AS id,name,''::text AS "startDate",
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
     FROM academic_years WHERE id = $1::bigint ${lock ? "FOR SHARE" : ""}`,
    [upload.periodId],
  );
  if (!periods.rowCount) throw new ImportProblem("Tahun ajaran tidak ditemukan atau sudah dihapus. Muat ulang halaman.");
  const classes = await client.query<SchoolClass>(
    `SELECT c.id::text AS id, c.level || ' ' || m.name AS label
     FROM school_classes c JOIN school_majors m ON m.id = c.major_id ORDER BY c.id
     ${lock ? "FOR SHARE OF c, m" : ""}`,
  );
  const placements = await client.query<Placement>(
    `SELECT id::text AS id,student_id::text AS "studentId",class_id::text AS "classId",
      class_name_snapshot AS "classNameSnapshot",status
     FROM academic_year_enrollments
     WHERE academic_year_id = $1::bigint AND student_id = ANY($2::bigint[])
     ORDER BY id ${lock ? "FOR UPDATE" : ""}`,
    [upload.periodId, students.rows.map((student) => student.id)],
  );
  const rows = planStudentImport(upload.rows, classes.rows, students.rows, placements.rows);
  const inactive = new Set(placements.rows.filter((p) => p.status !== "active").map((p) => p.studentId));
  for (const row of rows) if (row.student && inactive.has(row.student.id)) {
    row.status = "masalah"; row.issues.push("Siswa sudah berstatus lulus/keluar pada tahun ini. Periksa status secara manual.");
  }
  const counts = summarize(rows);
  // Hash mendeteksi pratinjau usang, bukan pengganti autentikasi atau validasi server.
  const token = counts.problems ? null : createHash("sha256").update(JSON.stringify({
    version: 1,
    adminId,
    fileHash: upload.hash,
    period: periods.rows[0],
    rows,
  })).digest("hex");
  return { period: periods.rows[0], rows, counts, token };
}

function publicPreview(plan: Plan): ImportPreview {
  const rows: ImportPreviewRow[] = plan.rows.map(({ rowNumber, name, nisn, className, status, issues }) => ({
    rowNumber, name, nisn, className, status, issues,
  }));
  return { periodName: plan.period.name, periodStart: plan.period.startDate, rows, counts: plan.counts, token: plan.token };
}

function knownMessage(error: unknown): string | null {
  if (error instanceof ImportProblem || error instanceof ImportFileError) return error.message;
  return null;
}

export async function previewImport(formData: FormData, adminId: string): Promise<ImportPreview> {
  const upload = await readUpload(formData);
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const plan = await makePlan(client, upload, adminId, false);
    await client.query("COMMIT");
    return publicPreview(plan);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function applyImport(formData: FormData, adminId: string): Promise<ImportCounts> {
  const expected = formData.get("previewToken");
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new ImportProblem("Pratinjau tidak valid. Periksa ulang file sebelum menyimpan.");
  }
  const upload = await readUpload(formData);
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin || admin.id !== adminId) throw new ImportProblem("Sesi admin berakhir. Masuk kembali.");
    await lockAcademicMutation(client);
    const plan = await makePlan(client, upload, adminId, true);
    if (!plan.token || plan.token !== expected) {
      throw new ImportProblem("File atau data telah berubah sejak pratinjau. Periksa ulang sebelum menyimpan; tidak ada perubahan yang disimpan.");
    }
    const newRows = plan.rows.filter((row) => row.status === "siswa-baru");
    const newIds = new Map<string, string>();
    if (newRows.length) {
      const inserted = await client.query<{ id: string; nisn: string }>(
        `INSERT INTO school_students (name, nisn)
         SELECT name, nisn FROM unnest($1::text[], $2::text[]) AS input(name, nisn)
         RETURNING id::text AS id, nisn`,
        [newRows.map((row) => row.name), newRows.map((row) => row.nisn)],
      );
      for (const row of inserted.rows) newIds.set(row.nisn, row.id);
      if (inserted.rowCount !== newRows.length) throw new Error("Jumlah siswa yang disimpan tidak sesuai.");
    }
    const toPlace = plan.rows.filter((row) => row.status === "siswa-baru" || row.status === "penempatan-baru");
    if (toPlace.length) {
      const studentIds = toPlace.map((row) => row.student?.id ?? newIds.get(row.nisn));
      if (studentIds.some((id) => !id) || toPlace.some((row) => !row.schoolClass)) throw new Error("Rencana penempatan tidak lengkap.");
      const inserted = await client.query(
        `INSERT INTO academic_year_enrollments (student_id, academic_year_id, class_id, class_name_snapshot, status)
         SELECT input.student_id::bigint, $1::bigint, input.class_id::bigint, input.class_name,'active'
         FROM unnest($2::text[], $3::text[], $4::text[]) AS input(student_id, class_id, class_name)`,
        [upload.periodId, studentIds, toPlace.map((row) => row.schoolClass!.id), toPlace.map((row) => row.schoolClass!.label)],
      );
      if (inserted.rowCount !== toPlace.length) throw new Error("Jumlah penempatan yang disimpan tidak sesuai.");
      await syncYearPlacements(client, upload.periodId, studentIds as string[]);
    }
    const stillActive = await lockActiveAdminSession(client);
    if (!stillActive || stillActive.id !== adminId) throw new ImportProblem("Sesi admin berakhir. Masuk kembali.");
    await client.query("COMMIT");
    return plan.counts;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (typeof error === "object" && error !== null && "code" in error && ["23505", "23503", "23001", "40001", "40P01"].includes(String(error.code))) {
      throw new ImportProblem("Data berubah atau berbenturan saat penyimpanan. Tidak ada perubahan yang disimpan; periksa ulang file.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export function importErrorMessage(error: unknown, saving: boolean): string {
  return knownMessage(error) ?? (saving
    ? "Hasil penyimpanan belum dapat dipastikan. Periksa Data Siswa dan koneksi, lalu buat pratinjau ulang sebelum mencoba lagi."
    : "Pratinjau belum dapat dibuat. Periksa koneksi database, migrasi, dan file, lalu coba lagi.");
}
