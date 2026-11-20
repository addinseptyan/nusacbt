"use server";

import { revalidatePath } from "next/cache";

import { lockActiveAdminSession, requireAdmin } from "@/lib/admin-auth";
import { getPostgresPool } from "@/lib/postgres";
import { validPeriodId, validatePeriodInput } from "@/lib/period-validation.mjs";
import { validTopicRevision as validRowRevision } from "@/lib/topic-validation.mjs";

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

class LoginPeriodProblem extends Error {}

// Perubahan periode dan pengakhiran sesi harus satu transaksi. Login menahan
// lock SHARE pada baris yang sama sampai sesi terbit, sehingga sesi dari
// periode lama tidak dapat lolos ketika admin mengganti periode bersamaan.
export async function setActiveLoginPeriod(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const targets = formData.getAll("periodId");
  const expectedValues = formData.getAll("expectedPeriodId");
  const revisions = formData.getAll("expectedRevision");
  const targetRevisions = formData.getAll("targetRevision");
  if (targets.length !== 1 || expectedValues.length !== 1 || revisions.length !== 1 || targetRevisions.length !== 1 || typeof targets[0] !== "string" || typeof expectedValues[0] !== "string" || typeof targetRevisions[0] !== "string") {
    return { ok: false, error: "Permintaan tidak valid. Muat ulang halaman." };
  }
  const target = targets[0] === "" ? null : validPeriodId(targets[0]);
  const expected = expectedValues[0] === "" ? null : validPeriodId(expectedValues[0]);
  const revision = validRowRevision(revisions[0]);
  const targetRevision = target ? validRowRevision(targetRevisions[0]) : null;
  if ((targets[0] !== "" && !target) || (expectedValues[0] !== "" && !expected) || !revision ||
      (target ? !targetRevision : targetRevisions[0] !== "")) {
    return { ok: false, error: "Identitas periode tidak valid." };
  }

  try {
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const admin = await lockActiveAdminSession(client);
      if (!admin) throw new LoginPeriodProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
      const result = await client.query<{ periodId: string | null; revision: string }>(
        'SELECT period_id::text AS "periodId", xmin::text AS revision FROM participant_login_settings WHERE id = 1 FOR UPDATE',
      );
      if (result.rowCount !== 1) throw new Error("Pengaturan login peserta tidak tersedia.");
      // Revisi juga mendeteksi A → B → A saat dialog lama masih terbuka.
      if (result.rows[0].periodId !== expected || result.rows[0].revision !== revision) {
        throw new LoginPeriodProblem("Periode login sudah berubah di sesi lain. Tidak ada perubahan; muat ulang halaman.");
      }
      const changed = result.rows[0].periodId !== target;
      if (changed) {
        if (target) {
          const period = await client.query<{ revision: string }>("SELECT xmin::text AS revision FROM exam_periods WHERE id = $1::bigint FOR SHARE", [target]);
          if (!period.rowCount) throw new LoginPeriodProblem("Periode tidak ditemukan atau sudah dihapus. Muat ulang halaman.");
          if (period.rows[0].revision !== targetRevision) throw new LoginPeriodProblem("Data periode tujuan sudah berubah. Tidak ada perubahan; muat ulang halaman.");
        }
        await client.query("UPDATE participant_login_settings SET period_id = $1::bigint WHERE id = 1", [target]);
        await client.query("DELETE FROM participant_sessions");
      }
      const stillActive = await lockActiveAdminSession(client);
      if (!stillActive || stillActive.id !== admin.id) throw new LoginPeriodProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
      await client.query("COMMIT");
      revalidatePath("/data-peserta/periode");
      revalidatePath("/peserta/login");
      revalidatePath("/peserta");
      return { ok: true, message: !changed ? "Periode login tidak berubah." : target ? "Periode login diaktifkan. Sesi peserta sebelumnya diakhiri." : "Login peserta dinonaktifkan. Sesi peserta sebelumnya diakhiri." };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  } catch (error) {
    if (error instanceof LoginPeriodProblem) return { ok: false, error: error.message };
    return { ok: false, error: "Hasil pengaturan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang halaman." };
  }
}
