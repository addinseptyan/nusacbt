"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { requireAdmin } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";
import { validateStudentInput } from "@/lib/student-validation.mjs";

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function hasSqlState(error: unknown, ...codes: string[]): boolean {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}

function hasConstraint(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && "constraint" in error && error.constraint === name;
}

function validStudentVersion(value: FormDataEntryValue | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value);
}

export async function saveStudent(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const rawId = formData.get("id");
  const id = rawId === null || rawId === "" ? null : validDataId(rawId);
  if (rawId !== null && rawId !== "" && !id) return { ok: false, error: "Identitas siswa tidak valid." };
  const version = formData.get("version");
  if (id && !validStudentVersion(version)) return { ok: false, error: "Versi data siswa tidak valid. Muat ulang daftar." };
  const parsed = validateStudentInput({ name: formData.get("name"), nisn: formData.get("nisn") });
  if (!parsed.ok) return parsed;

  try {
    if (id) {
      const result = await getPostgresPool().query(
        `UPDATE school_students SET name = $1, nisn = $2,
          updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
         WHERE id = $3::bigint AND updated_at = $4::timestamptz RETURNING id`,
        [parsed.value.name, parsed.value.nisn, id, version],
      );
      if (!result.rowCount) return { ok: false, error: "Data siswa sudah berubah atau sudah dihapus. Muat ulang daftar sebelum mencoba lagi." };
    } else {
      await getPostgresPool().query("INSERT INTO school_students (name, nisn) VALUES ($1, $2)", [parsed.value.name, parsed.value.nisn]);
    }
  } catch (error) {
    if (hasSqlState(error, "23505") && hasConstraint(error, "school_students_nisn_key")) {
      return { ok: false, error: "NISN sudah digunakan oleh siswa lain." };
    }
    return { ok: false, error: "Hasil penyimpanan belum dapat dipastikan. Periksa koneksi dan migrasi, lalu muat ulang daftar sebelum mencoba lagi." };
  }
  revalidatePath("/data-peserta/siswa");
  return { ok: true, message: id ? "Data siswa berhasil diubah." : "Siswa berhasil ditambahkan." };
}

export async function deleteStudent(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = validDataId(formData.get("id"));
  if (!id) return { ok: false, error: "Identitas siswa tidak valid." };
  const version = formData.get("version");
  if (!validStudentVersion(version)) return { ok: false, error: "Versi data siswa tidak valid. Muat ulang daftar." };
  try {
    const result = await getPostgresPool().query(
      "DELETE FROM school_students WHERE id = $1::bigint AND updated_at = $2::timestamptz RETURNING id",
      [id, version],
    );
    if (!result.rowCount) return { ok: false, error: "Data siswa sudah berubah atau sudah dihapus. Muat ulang daftar sebelum mencoba lagi." };
  } catch (error) {
    // PostgreSQL 17 memakai 23503 untuk RESTRICT; PostgreSQL 18 memakai 23001.
    if (hasSqlState(error, "23503", "23001")) {
      return { ok: false, error: "Siswa memiliki riwayat penempatan atau masih digunakan oleh data lain dan tidak dapat dihapus. Riwayat tetap dijaga." };
    }
    return { ok: false, error: "Hasil penghapusan belum dapat dipastikan. Periksa koneksi, lalu muat ulang daftar sebelum mencoba lagi." };
  }
  revalidatePath("/data-peserta/siswa");
  return { ok: true, message: "Siswa berhasil dihapus." };
}

export async function savePlacement(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const studentId = validDataId(formData.get("studentId"));
  const periodId = validDataId(formData.get("periodId"));
  const classId = validDataId(formData.get("classId"));
  const rawExpected = formData.get("expectedPlacementId");
  const expectedId = rawExpected === "" ? null : validDataId(rawExpected);
  if (!studentId) return { ok: false, error: "Identitas siswa tidak valid." };
  if (!periodId) return { ok: false, error: "Pilih periode yang valid." };
  if (!classId) return { ok: false, error: "Pilih kelas yang valid." };
  if (rawExpected === null || (rawExpected !== "" && !expectedId)) return { ok: false, error: "Data penempatan tidak valid. Muat ulang halaman." };

  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    // Kunci siswa agar perubahan penempatan pada siswa yang sama tidak saling menimpa.
    const student = await client.query("SELECT id FROM school_students WHERE id = $1::bigint FOR UPDATE", [studentId]);
    if (!student.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Siswa tidak ditemukan atau sudah dihapus." };
    }
    const period = await client.query("SELECT id FROM exam_periods WHERE id = $1::bigint FOR KEY SHARE", [periodId]);
    if (!period.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Periode tidak ditemukan atau sudah dihapus. Muat ulang daftar." };
    }
    // Lindungi nama kelas yang disalin dari perubahan bersamaan ketika penempatan dibuat.
    const schoolClass = await client.query<{ label: string }>(
      `SELECT c.level || ' ' || m.name AS label
       FROM school_classes c JOIN school_majors m ON m.id = c.major_id
       WHERE c.id = $1::bigint FOR SHARE OF c, m`,
      [classId],
    );
    if (!schoolClass.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Kelas tidak ditemukan atau sudah dihapus. Muat ulang daftar." };
    }
    const existing = await client.query<{ id: string; classId: string }>(
      `SELECT id::text AS id, class_id::text AS "classId" FROM student_class_placements
       WHERE student_id = $1::bigint AND period_id = $2::bigint AND ended_at IS NULL FOR UPDATE`,
      [studentId, periodId],
    );
    const active = existing.rows[0];
    if ((active?.id ?? null) !== expectedId) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Penempatan berubah di sesi lain. Muat ulang daftar sebelum mencoba lagi." };
    }
    if (active?.classId === classId) {
      await client.query("COMMIT");
      return { ok: true, message: "Penempatan sudah sesuai. Riwayat kelas tetap tersimpan." };
    }
    if (active) {
      await client.query("UPDATE student_class_placements SET ended_at = GREATEST(clock_timestamp(), started_at) WHERE id = $1::bigint", [active.id]);
    }
    await client.query(
      `INSERT INTO student_class_placements (student_id, period_id, class_id, class_name_snapshot, started_at)
       VALUES ($1::bigint, $2::bigint, $3::bigint, $4, clock_timestamp())`,
      [studentId, periodId, classId, schoolClass.rows[0].label],
    );
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (hasSqlState(error, "23505") && hasConstraint(error, "student_class_placements_one_active_idx")) {
      return { ok: false, error: "Penempatan berubah di sesi lain. Muat ulang daftar sebelum mencoba lagi." };
    }
    if (hasSqlState(error, "23503")) return { ok: false, error: "Siswa, periode, atau kelas tidak ditemukan. Muat ulang daftar." };
    return { ok: false, error: "Hasil penyimpanan belum dapat dipastikan. Periksa koneksi, lalu muat ulang daftar sebelum mencoba lagi." };
  } finally {
    client?.release();
  }
  revalidatePath("/data-peserta/siswa");
  return { ok: true, message: "Penempatan disimpan; riwayat sebelumnya tetap terjaga." };
}

export async function endPlacement(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const studentId = validDataId(formData.get("studentId"));
  const placementId = validDataId(formData.get("placementId"));
  if (!studentId || !placementId) return { ok: false, error: "Identitas penempatan tidak valid." };

  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    const student = await client.query("SELECT id FROM school_students WHERE id = $1::bigint FOR UPDATE", [studentId]);
    if (!student.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Siswa tidak ditemukan atau sudah dihapus." };
    }
    const result = await client.query(
      `UPDATE student_class_placements SET ended_at = GREATEST(clock_timestamp(), started_at)
       WHERE id = $1::bigint AND student_id = $2::bigint AND ended_at IS NULL RETURNING id`,
      [placementId, studentId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Penempatan sudah berubah atau sudah diakhiri. Muat ulang daftar." };
    }
    await client.query("COMMIT");
  } catch {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: "Hasil perubahan belum dapat dipastikan. Periksa koneksi, lalu muat ulang daftar sebelum mencoba lagi." };
  } finally {
    client?.release();
  }
  revalidatePath("/data-peserta/siswa");
  return { ok: true, message: "Penempatan diakhiri; riwayatnya tetap tersimpan." };
}
