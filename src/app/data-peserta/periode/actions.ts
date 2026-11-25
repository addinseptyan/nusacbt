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
    if (!await lockSchedulePeriod(client, id)) throw new PeriodDeleteProblem("Periode tidak ditemukan atau sudah dihapus.");
    const activeCheck = await client.query(
      "SELECT 1 FROM exam_periods WHERE id=$1::bigint AND is_active=true LIMIT 1",
      [id],
    );
    if (activeCheck.rowCount) {
      throw new PeriodDeleteProblem("Periode sedang aktif untuk login peserta dan tidak dapat dihapus. Nonaktifkan login periode terlebih dahulu.");
    }
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

/**
 * Mengaktifkan / menonaktifkan satu periode (multi-periode aktif), atau menonaktifkan seluruh periode login.
 * Pengaturan & sesi peserta diperbarui atomik dalam satu transaksi.
 */
export async function setActiveLoginPeriod(formData: FormData): Promise<ActionResult> {
  const { allowed } = await requireAdminAccess("periods.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };

  const targets = formData.getAll("periodId");
  const modes = formData.getAll("mode");
  const revisions = formData.getAll("expectedRevision");
  const targetRevisions = formData.getAll("targetRevision");
  if (targets.length !== 1 || revisions.length !== 1 || targetRevisions.length !== 1 ||
      typeof targets[0] !== "string" || typeof targetRevisions[0] !== "string") {
    return { ok: false, error: "Permintaan tidak valid. Muat ulang halaman." };
  }
  const mode = modes.length === 1 && typeof modes[0] === "string" ? modes[0] : (targets[0] === "" ? "clear_all" : "activate");
  if (!["activate", "deactivate", "clear_all"].includes(mode)) {
    return { ok: false, error: "Tindakan status login tidak valid." };
  }
  const target = targets[0] === "" ? null : validPeriodId(targets[0]);
  const revision = validRowRevision(revisions[0]);
  const targetRevision = target ? validRowRevision(targetRevisions[0]) : null;
  if ((targets[0] !== "" && !target) || !revision || (target ? !targetRevision : targetRevisions[0] !== "")) {
    return { ok: false, error: "Identitas periode tidak valid." };
  }
  if (mode !== "clear_all" && !target) {
    return { ok: false, error: "Identitas periode tujuan wajib diisi." };
  }

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

    let messageText = "Status login periode diperbarui.";
    if (mode === "clear_all") {
      if (result.rows[0].revision !== revision) {
        throw new LoginPeriodProblem("Pengaturan login sudah berubah di sesi lain. Muat ulang halaman.");
      }
      await client.query("UPDATE exam_periods SET is_active = false, updated_at = clock_timestamp() WHERE is_active = true");
      await client.query("UPDATE participant_login_settings SET period_id = NULL WHERE id = 1");
      await client.query("DELETE FROM participant_sessions");
      messageText = "Semua login peserta dinonaktifkan. Seluruh sesi peserta telah diakhiri.";
    } else {
      const period = await client.query<{ revision: string; yearId: string | null; activeYear: string | null; isActive: boolean; name: string }>(
        `SELECT e.xmin::text AS revision, e.academic_year_id::text AS "yearId", ys.active_year_id::text AS "activeYear",
           e.is_active AS "isActive", e.name
         FROM exam_periods e CROSS JOIN academic_year_settings ys
         WHERE e.id = $1::bigint AND ys.id = 1 FOR UPDATE OF e`,
        [target],
      );
      if (!period.rowCount) throw new LoginPeriodProblem("Periode tidak ditemukan atau sudah dihapus. Muat ulang halaman.");
      const row = period.rows[0];
      if (row.revision !== targetRevision) throw new LoginPeriodProblem("Data periode tujuan sudah berubah. Tidak ada perubahan; muat ulang halaman.");

      if (mode === "activate") {
        if (row.isActive) throw new LoginPeriodProblem("Periode tersebut sudah aktif di sesi lain. Muat ulang halaman.");
        if (!row.yearId || row.yearId !== row.activeYear) throw new LoginPeriodProblem("Periode harus berada pada tahun ajaran yang sedang aktif.");
        await client.query("UPDATE exam_periods SET is_active = true, updated_at = clock_timestamp() WHERE id = $1::bigint", [target]);
        messageText = `Login periode ${row.name} diaktifkan.`;
      } else {
        if (!row.isActive) throw new LoginPeriodProblem("Periode tersebut sudah nonaktif di sesi lain. Muat ulang halaman.");
        await client.query("UPDATE exam_periods SET is_active = false, updated_at = clock_timestamp() WHERE id = $1::bigint", [target]);
        await client.query(
          "DELETE FROM participant_sessions s USING participant_identities i WHERE s.participant_identity_id = i.id AND i.period_id = $1::bigint",
          [target],
        );
        messageText = `Login periode ${row.name} dinonaktifkan. Sesi peserta pada periode tersebut diakhiri.`;
      }

      // Sinkronkan participant_login_settings.period_id dengan periode aktif pertama (atau NULL bila habis)
      const firstActive = await client.query<{ id: string }>(
        `SELECT e.id::text AS id FROM exam_periods e
         JOIN academic_year_settings ys ON ys.id = 1 AND ys.active_year_id = e.academic_year_id
         WHERE e.is_active = true ORDER BY e.start_date DESC, e.id DESC LIMIT 1`,
      );
      await client.query("UPDATE participant_login_settings SET period_id = $1::bigint WHERE id = 1", [firstActive.rows[0]?.id ?? null]);
    }

    const stillActive = await lockActiveAdminSession(client);
    if (!stillActive || stillActive.id !== admin.id) throw new LoginPeriodProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    await client.query("COMMIT");

    revalidatePath("/data-peserta/periode");
    revalidatePath("/data-peserta/kartu");
    revalidatePath("/peserta/login");
    revalidatePath("/peserta");
    revalidatePath("/");
    return { ok: true, message: messageText };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof LoginPeriodProblem) return { ok: false, error: error.message };
    return { ok: false, error: "Hasil pengaturan belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang halaman." };
  } finally {
    client.release();
  }
}
