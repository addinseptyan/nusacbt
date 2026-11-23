"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, PERMISSION_DENIED_MESSAGE, requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { validDataId, validateClassLevel, validateMajorName } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";

type ActionResult = { ok: true; message: string } | { ok: false; error: string };
class ClassActionProblem extends Error {}

function isReferenceRestriction(error: unknown): boolean {
  // RESTRICT memakai 23503 di PostgreSQL 17 dan 23001 mulai PostgreSQL 18.
  return typeof error === "object" && error !== null && "code" in error && (error.code === "23503" || error.code === "23001");
}

async function withClassPermission(fn: (client: PoolClient) => Promise<ActionResult>): Promise<ActionResult> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new ClassActionProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    if (!adminHasPermission(admin, "classes.manage")) throw new ClassActionProblem(PERMISSION_DENIED_MESSAGE);
    const result = await fn(client);
    if (!result.ok) {
      await client.query("ROLLBACK");
      return result;
    }
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id || !adminHasPermission(active, "classes.manage")) {
      throw new ClassActionProblem("Sesi atau hak akses admin berubah saat memproses tindakan.");
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof ClassActionProblem) return { ok: false, error: error.message };
    throw error;
  } finally {
    client.release();
  }
}

export async function saveMajor(formData: FormData): Promise<ActionResult> {
  const { allowed } = await requireAdminAccess("classes.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const rawId = formData.get("id");
  const id = rawId === null || rawId === "" ? null : validDataId(rawId);
  if (rawId !== null && rawId !== "" && !id) return { ok: false, error: "Identitas jurusan tidak valid." };
  const parsed = validateMajorName(formData.get("name"));
  if (!parsed.ok) return parsed;

  try {
    const result = await withClassPermission(async (client) => {
      if (id) {
        const res = await client.query(
          "UPDATE school_majors SET name = $1, updated_at = now() WHERE id = $2::bigint RETURNING id",
          [parsed.value, id],
        );
        if (!res.rowCount) return { ok: false, error: "Jurusan tidak ditemukan atau sudah dihapus." };
      } else {
        await client.query("INSERT INTO school_majors (name) VALUES ($1)", [parsed.value]);
      }
      return { ok: true, message: id ? "Jurusan berhasil diubah." : "Jurusan berhasil ditambahkan." };
    });
    if (result.ok) revalidatePath("/data-peserta/kelas");
    return result;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505" && "constraint" in error && error.constraint === "school_majors_name_ci_idx") {
      return { ok: false, error: "Nama atau kode jurusan sudah digunakan. Gunakan nama lain." };
    }
    return { ok: false, error: "Hasil penyimpanan belum dapat dipastikan. Periksa koneksi dan migrasi, lalu muat ulang daftar sebelum mencoba lagi." };
  }
}

export async function deleteMajor(formData: FormData): Promise<ActionResult> {
  const { allowed } = await requireAdminAccess("classes.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const id = validDataId(formData.get("id"));
  if (!id) return { ok: false, error: "Identitas jurusan tidak valid." };
  try {
    const result = await withClassPermission(async (client) => {
      const res = await client.query("DELETE FROM school_majors WHERE id = $1::bigint RETURNING id", [id]);
      if (!res.rowCount) return { ok: false, error: "Jurusan tidak ditemukan atau sudah dihapus." };
      return { ok: true, message: "Jurusan berhasil dihapus." };
    });
    if (result.ok) revalidatePath("/data-peserta/kelas");
    return result;
  } catch (error) {
    if (isReferenceRestriction(error)) {
      return { ok: false, error: "Jurusan masih digunakan oleh kelas dan tidak dapat dihapus. Ubah atau hapus kelas terkait terlebih dahulu." };
    }
    return { ok: false, error: "Hasil penghapusan belum dapat dipastikan. Periksa koneksi, lalu muat ulang daftar sebelum mencoba lagi." };
  }
}

export async function saveClass(formData: FormData): Promise<ActionResult> {
  const { allowed } = await requireAdminAccess("classes.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const rawId = formData.get("id");
  const id = rawId === null || rawId === "" ? null : validDataId(rawId);
  if (rawId !== null && rawId !== "" && !id) return { ok: false, error: "Identitas kelas tidak valid." };
  const parsed = validateClassLevel(formData.get("level"));
  if (!parsed.ok) return parsed;
  const majorId = validDataId(formData.get("majorId"));
  if (!majorId) return { ok: false, error: "Pilih jurusan yang valid." };

  try {
    const result = await withClassPermission(async (client) => {
      if (id) {
        const res = await client.query(
          "UPDATE school_classes SET level = $1, major_id = $2::bigint, updated_at = now() WHERE id = $3::bigint RETURNING id",
          [parsed.value, majorId, id],
        );
        if (!res.rowCount) return { ok: false, error: "Kelas tidak ditemukan atau sudah dihapus." };
      } else {
        await client.query("INSERT INTO school_classes (level, major_id) VALUES ($1, $2::bigint)", [parsed.value, majorId]);
      }
      return { ok: true, message: id ? "Kelas berhasil diubah." : "Kelas berhasil ditambahkan." };
    });
    if (result.ok) revalidatePath("/data-peserta/kelas");
    return result;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      if (error.code === "23505" && "constraint" in error && error.constraint === "school_classes_level_major_key") {
        return { ok: false, error: "Kelas dengan tingkat dan jurusan ini sudah ada." };
      }
      if (error.code === "23503") return { ok: false, error: "Jurusan tidak ditemukan atau sudah dihapus. Muat ulang daftar." };
    }
    return { ok: false, error: "Hasil penyimpanan belum dapat dipastikan. Periksa koneksi dan migrasi, lalu muat ulang daftar sebelum mencoba lagi." };
  }
}

export async function deleteClass(formData: FormData): Promise<ActionResult> {
  const { allowed } = await requireAdminAccess("classes.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const id = validDataId(formData.get("id"));
  if (!id) return { ok: false, error: "Identitas kelas tidak valid." };
  try {
    const result = await withClassPermission(async (client) => {
      const res = await client.query("DELETE FROM school_classes WHERE id = $1::bigint RETURNING id", [id]);
      if (!res.rowCount) return { ok: false, error: "Kelas tidak ditemukan atau sudah dihapus." };
      return { ok: true, message: "Kelas berhasil dihapus." };
    });
    if (result.ok) revalidatePath("/data-peserta/kelas");
    return result;
  } catch (error) {
    if (isReferenceRestriction(error)) {
      return { ok: false, error: "Kelas masih digunakan oleh data lain dan tidak dapat dihapus." };
    }
    return { ok: false, error: "Hasil penghapusan belum dapat dipastikan. Periksa koneksi, lalu muat ulang daftar sebelum mencoba lagi." };
  }
}
