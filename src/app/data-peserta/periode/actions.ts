"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin-auth";
import { getPostgresPool } from "@/lib/postgres";
import { validPeriodId, validatePeriodInput } from "@/lib/period-validation.mjs";

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function savePeriod(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const rawId = formData.get("id");
  const id = rawId === null || rawId === "" ? null : validPeriodId(rawId);
  if (rawId !== null && rawId !== "" && !id) return { ok: false, error: "Identitas periode tidak valid." };
  const parsed = validatePeriodInput({
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });
  if (!parsed.ok) return parsed;

  const { name, startDate, endDate } = parsed.value;
  try {
    if (id) {
      const result = await getPostgresPool().query(
        `UPDATE exam_periods SET name = $1, start_date = $2::date, end_date = $3::date, updated_at = now()
         WHERE id = $4::bigint RETURNING id`,
        [name, startDate, endDate, id],
      );
      if (!result.rowCount) return { ok: false, error: "Periode tidak ditemukan atau sudah dihapus." };
    } else {
      await getPostgresPool().query(
        "INSERT INTO exam_periods (name, start_date, end_date) VALUES ($1, $2::date, $3::date)",
        [name, startDate, endDate],
      );
    }
  } catch {
    return { ok: false, error: "Hasil penyimpanan belum dapat dipastikan. Periksa koneksi dan migrasi, lalu muat ulang daftar sebelum mencoba lagi." };
  }
  revalidatePath("/data-peserta/periode");
  return { ok: true, message: id ? "Periode berhasil diubah." : "Periode berhasil ditambahkan." };
}

export async function deletePeriod(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = validPeriodId(formData.get("id"));
  if (!id) return { ok: false, error: "Identitas periode tidak valid." };
  try {
    const result = await getPostgresPool().query("DELETE FROM exam_periods WHERE id = $1::bigint RETURNING id", [id]);
    if (!result.rowCount) return { ok: false, error: "Periode tidak ditemukan atau sudah dihapus." };
  } catch (error) {
    // RESTRICT memakai 23503 di PostgreSQL 17 dan 23001 mulai PostgreSQL 18.
    if (typeof error === "object" && error !== null && "code" in error && (error.code === "23503" || error.code === "23001")) {
      return { ok: false, error: "Periode masih digunakan oleh data lain dan tidak dapat dihapus." };
    }
    return { ok: false, error: "Hasil penghapusan belum dapat dipastikan. Periksa koneksi, lalu muat ulang daftar sebelum mencoba lagi." };
  }
  revalidatePath("/data-peserta/periode");
  return { ok: true, message: "Periode berhasil dihapus." };
}
