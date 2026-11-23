"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, PERMISSION_DENIED_MESSAGE, requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { AcademicYearProblem, attachPeriodToYear, lockAcademicMutation, syncYearPlacements } from "@/lib/academic-year-service";
import { lockSchedulePeriod } from "@/lib/exam-session-service";
import { getPostgresPool } from "@/lib/postgres";
import { validPeriodId, validatePeriodInput } from "@/lib/period-validation.mjs";
import { validTopicRevision as validRowRevision } from "@/lib/topic-validation.mjs";

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function savePeriod(formData: FormData): Promise<ActionResult> {
  const { allowed } = await requireAdminAccess("periods.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const rawId = formData.get("id");
  const id = rawId === null || rawId === "" ? null : validPeriodId(rawId);
  const yearId = validPeriodId(formData.get("yearId"));
  const revision = id ? validRowRevision(formData.get("expectedRevision")) : null;
  if ((rawId !== null && rawId !== "" && !id) || !yearId || (id && !revision)) return { ok: false, error: "Pilih tahun ajaran dan identitas periode yang valid. Muat ulang halaman." };
  const parsed = validatePeriodInput({ name: formData.get("name"), startDate: formData.get("startDate"), endDate: formData.get("endDate") });
  if (!parsed.ok) return parsed;
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    if (!adminHasPermission(admin, "periods.manage")) throw new AcademicYearProblem(PERMISSION_DENIED_MESSAGE);
    await lockAcademicMutation(client);
    const year = await client.query("SELECT id FROM academic_years WHERE id=$1::bigint FOR UPDATE", [yearId]);
    if (!year.rowCount) throw new AcademicYearProblem("Tahun ajaran tidak ditemukan.");
    if (id) {
      const current = await client.query<{ revision: string }>('SELECT xmin::text AS revision FROM exam_periods WHERE id=$1::bigint FOR UPDATE', [id]);
      if (!current.rowCount || current.rows[0].revision !== revision) throw new AcademicYearProblem("Periode telah berubah atau dihapus. Muat ulang halaman.");
      await attachPeriodToYear(client, id, yearId);
      await client.query("UPDATE exam_periods SET name=$1,start_date=$2::date,end_date=$3::date,updated_at=clock_timestamp() WHERE id=$4::bigint", [parsed.value.name, parsed.value.startDate, parsed.value.endDate, id]);
    } else {
      await client.query("INSERT INTO exam_periods(name,start_date,end_date,academic_year_id) VALUES($1,$2::date,$3::date,$4::bigint)", [parsed.value.name, parsed.value.startDate, parsed.value.endDate, yearId]);
      await syncYearPlacements(client, yearId);
    }
    const stillActive = await lockActiveAdminSession(client);
    if (!stillActive || stillActive.id !== admin.id) throw new AcademicYearProblem("Sesi admin sudah berakhir. Masuk kembali.");
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof AcademicYearProblem) return { ok: false, error: error.message };
    return { ok: false, error: "Hasil penyimpanan belum dapat dipastikan. Periksa koneksi, lalu muat ulang daftar." };
  } finally { client?.release(); }
  revalidatePath("/data-peserta/periode"); revalidatePath("/data-peserta/siswa");
  return { ok: true, message: id ? "Periode berhasil diubah." : "Periode berhasil ditambahkan; siswa aktif tahun tersebut tersedia pada periode." };
}

class PeriodDeleteProblem extends Error {}

export async function deletePeriod(formData: FormData): Promise<ActionResult> {
  const { allowed } = await requireAdminAccess("periods.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const id = validPeriodId(formData.get("id"));
  if (!id || formData.getAll("id").length !== 1) return { ok: false, error: "Identitas periode tidak valid." };
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new PeriodDeleteProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    if (!adminHasPermission(admin, "periods.manage")) throw new PeriodDeleteProblem(PERMISSION_DENIED_MESSAGE);
    // Satu pagar dengan perubahan kelompok/jadwal. Rencana kosong boleh
    // dibersihkan hanya bersamaan dengan penghapusan periodenya; kalau ada
    // referensi lain, seluruh transaksi termasuk pembersihan di-rollback.
    if (!await lockSchedulePeriod(client, id)) throw new PeriodDeleteProblem("Periode tidak ditemukan atau sudah dihapus.");
    const used = await client.query(
      `SELECT 1 FROM exam_session_assignments WHERE period_id=$1::bigint
       UNION ALL SELECT 1 FROM exam_schedule_runs WHERE period_id=$1::bigint AND kind='regular' LIMIT 1`, [id],
    );
    if (used.rowCount) throw new PeriodDeleteProblem("Periode masih digunakan oleh data lain dan tidak dapat dihapus.");
    await client.query("DELETE FROM exam_session_groups WHERE period_id=$1::bigint", [id]);
    await client.query("DELETE FROM exam_session_plans WHERE period_id=$1::bigint", [id]);
    const result = await client.query("DELETE FROM exam_periods WHERE id=$1::bigint RETURNING id", [id]);
    if (!result.rowCount) throw new PeriodDeleteProblem("Periode tidak ditemukan atau sudah dihapus.");
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new PeriodDeleteProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof PeriodDeleteProblem) return { ok: false, error: error.message };
    // RESTRICT memakai 23503 di PostgreSQL 17 dan 23001 mulai PostgreSQL 18.
    if (typeof error === "object" && error !== null && "code" in error && (error.code === "23503" || error.code === "23001")) {
      return { ok: false, error: "Periode masih digunakan oleh data lain dan tidak dapat dihapus." };
    }
    return { ok: false, error: "Hasil penghapusan belum dapat dipastikan. Periksa koneksi, lalu muat ulang daftar sebelum mencoba lagi." };
  } finally { client?.release(); }
  revalidatePath("/data-peserta/periode");
  revalidatePath("/data-tes/daftar/sesi");
  return { ok: true, message: "Periode berhasil dihapus." };
}

class LoginPeriodProblem extends Error {}

// Perubahan periode dan pengakhiran sesi harus satu transaksi. Login menahan
// lock SHARE pada baris yang sama sampai sesi terbit, sehingga sesi dari
// periode lama tidak dapat lolos ketika admin mengganti periode bersamaan.
export async function setActiveLoginPeriod(formData: FormData): Promise<ActionResult> {
  const { allowed } = await requireAdminAccess("periods.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
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
      if (!adminHasPermission(admin, "periods.manage")) throw new LoginPeriodProblem(PERMISSION_DENIED_MESSAGE);
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
          const period = await client.query<{ revision: string; yearId: string | null; activeYear: string | null }>(
            `SELECT e.xmin::text AS revision,e.academic_year_id::text AS "yearId",ys.active_year_id::text AS "activeYear"
             FROM exam_periods e CROSS JOIN academic_year_settings ys WHERE e.id=$1::bigint AND ys.id=1 FOR SHARE OF e,ys`, [target]);
          if (!period.rowCount) throw new LoginPeriodProblem("Periode tidak ditemukan atau sudah dihapus. Muat ulang halaman.");
          if (period.rows[0].revision !== targetRevision) throw new LoginPeriodProblem("Data periode tujuan sudah berubah. Tidak ada perubahan; muat ulang halaman.");
          if (!period.rows[0].yearId || period.rows[0].yearId !== period.rows[0].activeYear) throw new LoginPeriodProblem("Periode harus berada pada tahun ajaran yang sedang aktif.");
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
