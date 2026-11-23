"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, PERMISSION_DENIED_MESSAGE, requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { validDataId } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";
import { validateStudentInput } from "@/lib/student-validation.mjs";

type ActionResult = { ok: true; message: string } | { ok: false; error: string };
class StudentActionProblem extends Error {}

function hasSqlState(error: unknown, ...codes: string[]): boolean {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}

function hasConstraint(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && "constraint" in error && error.constraint === name;
}

function validStudentVersion(value: FormDataEntryValue | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value);
}

async function withStudentPermission(fn: (client: PoolClient) => Promise<ActionResult>): Promise<ActionResult> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new StudentActionProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    if (!adminHasPermission(admin, "students.manage")) throw new StudentActionProblem(PERMISSION_DENIED_MESSAGE);
    const result = await fn(client);
    if (!result.ok) {
      await client.query("ROLLBACK");
      return result;
    }
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id || !adminHasPermission(active, "students.manage")) {
      throw new StudentActionProblem("Sesi atau hak akses admin berubah saat memproses tindakan.");
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof StudentActionProblem) return { ok: false, error: error.message };
    throw error;
  } finally {
    client.release();
  }
}

export async function saveStudent(formData: FormData): Promise<ActionResult> {
  const { allowed } = await requireAdminAccess("students.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const rawId = formData.get("id");
  const id = rawId === null || rawId === "" ? null : validDataId(rawId);
  if (rawId !== null && rawId !== "" && !id) return { ok: false, error: "Identitas siswa tidak valid." };
  const version = formData.get("version");
  if (id && !validStudentVersion(version)) return { ok: false, error: "Versi data siswa tidak valid. Muat ulang daftar." };
  const parsed = validateStudentInput({ name: formData.get("name"), nisn: formData.get("nisn") });
  if (!parsed.ok) return parsed;

  try {
    const result = await withStudentPermission(async (client) => {
      if (id) {
        const res = await client.query(
          `UPDATE school_students SET name = $1, nisn = $2,
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
           WHERE id = $3::bigint AND updated_at = $4::timestamptz RETURNING id`,
          [parsed.value.name, parsed.value.nisn, id, version],
        );
        if (!res.rowCount) return { ok: false, error: "Data siswa sudah berubah atau sudah dihapus. Muat ulang daftar sebelum mencoba lagi." };
      } else {
        await client.query("INSERT INTO school_students (name, nisn) VALUES ($1, $2)", [parsed.value.name, parsed.value.nisn]);
      }
      return { ok: true, message: id ? "Data siswa berhasil diubah." : "Siswa berhasil ditambahkan." };
    });
    if (result.ok) revalidatePath("/data-peserta/siswa");
    return result;
  } catch (error) {
    if (hasSqlState(error, "23505") && hasConstraint(error, "school_students_nisn_key")) {
      return { ok: false, error: "NISN sudah digunakan oleh siswa lain." };
    }
    return { ok: false, error: "Hasil penyimpanan belum dapat dipastikan. Periksa koneksi dan migrasi, lalu muat ulang daftar sebelum mencoba lagi." };
  }
}

export async function deleteStudent(formData: FormData): Promise<ActionResult> {
  const { allowed } = await requireAdminAccess("students.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const id = validDataId(formData.get("id"));
  if (!id) return { ok: false, error: "Identitas siswa tidak valid." };
  const version = formData.get("version");
  if (!validStudentVersion(version)) return { ok: false, error: "Versi data siswa tidak valid. Muat ulang daftar." };
  try {
    const result = await withStudentPermission(async (client) => {
      const res = await client.query(
        "DELETE FROM school_students WHERE id = $1::bigint AND updated_at = $2::timestamptz RETURNING id",
        [id, version],
      );
      if (!res.rowCount) return { ok: false, error: "Data siswa sudah berubah atau sudah dihapus. Muat ulang daftar sebelum mencoba lagi." };
      return { ok: true, message: "Siswa berhasil dihapus." };
    });
    if (result.ok) revalidatePath("/data-peserta/siswa");
    return result;
  } catch (error) {
    // PostgreSQL 17 memakai 23503 untuk RESTRICT; PostgreSQL 18 memakai 23001.
    if (hasSqlState(error, "23503", "23001")) {
      return { ok: false, error: "Siswa memiliki riwayat penempatan atau masih digunakan oleh data lain dan tidak dapat dihapus. Riwayat tetap dijaga." };
    }
    return { ok: false, error: "Hasil penghapusan belum dapat dipastikan. Periksa koneksi, lalu muat ulang daftar sebelum mencoba lagi." };
  }
}

// Penempatan kini bersumber dari roster tahun ajaran. Aksi lama yang mungkin
// masih terbuka di tab lain ditolak agar tidak membuat kelas per periode berbeda.
export async function savePlacement(_formData: FormData): Promise<ActionResult> {
  void _formData;
  const { allowed } = await requireAdminAccess("students.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  return { ok: false, error: "Penempatan sekarang dikelola berdasarkan tahun ajaran. Muat ulang Data Siswa." };
}
export async function endPlacement(_formData: FormData): Promise<ActionResult> {
  void _formData;
  const { allowed } = await requireAdminAccess("students.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  return { ok: false, error: "Status siswa sekarang dikelola berdasarkan tahun ajaran. Muat ulang Data Siswa." };
}
