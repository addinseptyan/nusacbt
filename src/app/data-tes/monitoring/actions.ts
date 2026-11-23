"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { getAdminSession, lockActiveAdminSession, PERMISSION_DENIED_MESSAGE } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { validDataId } from "@/lib/class-validation.mjs";
import { examAnswerRevision } from "@/lib/exam-attempt-validation.mjs";
import { validTokenOperationId } from "@/lib/exam-token-validation.mjs";
import { lockFinalGradePair, readFinalGradeState } from "@/lib/exam-final-grade-server";
import { getPostgresPool } from "@/lib/postgres";

export type RetakeActionResult = { ok: true; message: string } | { ok: false; error: string; uncertain?: boolean };
export type RetakeResolveResult = { ok: true; outcome: "applied" | "cancelled"; permissionId: string | null } | { ok: false; error: string };
class RetakeProblem extends Error {}

type Attempt = { id: string; runId: string; identityId: string; completed: boolean };
type Permission = { id: string; revoked: boolean; consumed: boolean };
type Operation = { attemptId: string; action: "grant" | "revoke"; result: "applied" | "cancelled"; permissionId: string | null };

async function lockOperation(client: PoolClient, operationId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('nusacbt:retake-operation:' || $1::text, 0))", [operationId]);
}
async function readOperation(client: PoolClient, operationId: string): Promise<Operation | null> {
  const result = await client.query<Operation>(
    `SELECT attempt_id::text AS "attemptId",action,result,permission_id::text AS "permissionId"
     FROM exam_retake_operations WHERE operation_id=$1::uuid`, [operationId],
  );
  return result.rows[0] ?? null;
}

/**
 * Admin mengunci tes dan pelaksanaan sebelum attempt, sama seperti layanan
 * mulai/jadwal. Kunci attempt juga menserialkan penerbitan, pencabutan dan
 * pemakaian izin untuk pengerjaan tersebut. Data/form dari browser bukan
 * sumber otorisasi atau status; seluruh aturan diperiksa ulang di database.
 */
export async function changeRetakePermission(form: FormData): Promise<RetakeActionResult> {
  const session = await getAdminSession();
  if (session && !adminHasPermission(session, "grading_overrides.manage")) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  }
  if (!(form instanceof FormData) || ["operation", "operationId", "attemptId", "expectedPermissionId", "expectedFinalRevision"].some((field) => form.getAll(field).length !== 1)) {
    return { ok: false, error: "Data izin tidak valid. Muat ulang halaman." };
  }
  const operation = form.get("operation");
  const operationId = validTokenOperationId(form.get("operationId"));
  const attemptId = validDataId(form.get("attemptId"));
  const expectedRaw = form.get("expectedPermissionId");
  const expected = expectedRaw === "" ? null : validDataId(expectedRaw);
  const expectedFinalRevision = examAnswerRevision(form.get("expectedFinalRevision"));
  if (!attemptId || !operationId || expectedFinalRevision === null || (operation !== "grant" && operation !== "revoke") || (expectedRaw !== "" && !expected) || (operation === "revoke" && !expected)) {
    return { ok: false, error: "Data izin tidak valid. Muat ulang halaman." };
  }

  let client: PoolClient | undefined;
  let transactionOpen = false; let operationLocked = false;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN"); transactionOpen = true;
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new RetakeProblem("Sesi admin berakhir. Masuk kembali dan muat ulang.");
    if (!adminHasPermission(admin, "grading_overrides.manage")) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return { ok: false, error: PERMISSION_DENIED_MESSAGE };
    }
    // Lock per UUID diambil sebelum lock tes/attempt. Pemeriksaan pemulihan
    // memakai lock yang sama dan dapat memagari request yang tiba terlambat.
    await lockOperation(client, operationId);
    // Savepoint dibuat setelah advisory lock: kegagalan aturan dapat
    // dibatalkan, tetapi UUID tetap dipagari sebelum transaksi dilepas.
    await client.query("SAVEPOINT retake_decision"); operationLocked = true;
    const prior = await readOperation(client, operationId);
    if (prior) {
      if (prior.attemptId !== attemptId || prior.action !== operation) throw new RetakeProblem("Identitas permintaan tidak cocok. Muat ulang daftar.");
      if (prior.result === "cancelled") throw new RetakeProblem("Permintaan ini sudah diamankan dan tidak dapat dijalankan. Muat ulang daftar.");
      const active = await lockActiveAdminSession(client);
      if (!active || active.id !== admin.id) throw new RetakeProblem("Sesi admin berakhir. Masuk kembali dan muat ulang.");
      await client.query("COMMIT"); transactionOpen = false;
      return { ok: true, message: "Tindakan ini sudah diproses. Muat ulang untuk melihat status terkini." };
    }
    const lookup = await client.query<{ runId: string; testId: string; identityId: string }>(
      `SELECT a.run_id::text AS "runId",a.exam_test_id::text AS "testId",a.participant_identity_id::text AS "identityId"
       FROM exam_attempts a WHERE a.id=$1::bigint`, [attemptId],
    );
    const candidate = lookup.rows[0];
    if (!candidate) throw new RetakeProblem("Pengerjaan tidak ditemukan. Muat ulang daftar.");
    if (!(await client.query("SELECT id FROM exam_tests WHERE id=$1::bigint FOR SHARE", [candidate.testId])).rowCount ||
        !(await client.query("SELECT id FROM exam_schedule_runs WHERE id=$1::bigint AND exam_test_id=$2::bigint FOR SHARE", [candidate.runId, candidate.testId])).rowCount) {
      throw new RetakeProblem("Jadwal berubah. Muat ulang daftar.");
    }
    await lockFinalGradePair(client, candidate.testId, candidate.identityId);
    const finalState = await readFinalGradeState(client, candidate.testId, candidate.identityId);
    if (operation === "grant" && finalState.finalized) {
      throw new RetakeProblem("Nilai akhir sudah ditetapkan. Buka kembali nilai sebelum memberikan izin mengulang.");
    }
    if (finalState.revision !== expectedFinalRevision) throw new RetakeProblem("Status nilai akhir sudah berubah. Muat ulang dan periksa izin kembali.");
    const locked = await client.query<Attempt>(
      `SELECT id::text AS id,run_id::text AS "runId",participant_identity_id::text AS "identityId",
        completed_at IS NOT NULL AS completed FROM exam_attempts
       WHERE id=$1::bigint AND run_id=$2::bigint FOR UPDATE`, [attemptId, candidate.runId],
    );
    const attempt = locked.rows[0];
    if (!attempt) throw new RetakeProblem("Pengerjaan berubah. Muat ulang daftar.");
    const latest = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM exam_attempts WHERE run_id=$1::bigint AND participant_identity_id=$2::bigint
       ORDER BY id DESC LIMIT 1`, [attempt.runId, attempt.identityId],
    );
    const permissions = await client.query<Permission>(
      `SELECT id::text AS id,revoked_at IS NOT NULL AS revoked,consumed_at IS NOT NULL AS consumed
       FROM exam_retake_permissions WHERE previous_attempt_id=$1::bigint ORDER BY id DESC LIMIT 1 FOR UPDATE`, [attempt.id],
    );
    const last = permissions.rows[0] ?? null;
    if ((last?.id ?? null) !== expected) throw new RetakeProblem("Status izin sudah berubah. Muat ulang dan periksa kembali.");
    if (operation === "revoke" && (!last || last.revoked || last.consumed)) throw new RetakeProblem("Izin sudah dicabut atau digunakan. Muat ulang daftar.");
    if (latest.rows[0]?.id !== attempt.id || !attempt.completed) {
      throw new RetakeProblem("Izin hanya dapat diubah untuk pengerjaan terakhir yang sudah selesai. Muat ulang daftar.");
    }

    let permissionId: string;
    if (operation === "grant") {
      if (last && !last.revoked) throw new RetakeProblem("Izin sudah tersedia atau sudah digunakan. Muat ulang daftar.");
      // Periksa jam database setelah menunggu seluruh kunci. Deadline attempt
      // sebelumnya adalah batas awal yang tidak boleh diperpanjang.
      const created = await client.query<{ id: string }>(
        `INSERT INTO exam_retake_permissions(run_id,participant_identity_id,previous_attempt_id,granted_by)
         SELECT a.run_id,a.participant_identity_id,a.id,$2::bigint
         FROM exam_attempts a JOIN exam_schedule_runs r ON r.id=a.run_id
         WHERE a.id=$1::bigint AND a.completed_at IS NOT NULL AND a.deadline>clock_timestamp()
           AND r.published_at IS NOT NULL AND r.starts_at<=clock_timestamp()
           AND r.starts_at+r.duration_minutes*interval '1 minute'>clock_timestamp()
         RETURNING id::text AS id`, [attempt.id, admin.id],
      );
      if (!created.rowCount) throw new RetakeProblem("Jadwal atau batas waktu awal telah berakhir. Izin tidak dibuat.");
      permissionId = created.rows[0].id;
    } else {
      if (!last || last.revoked || last.consumed) throw new RetakeProblem("Izin sudah dicabut atau digunakan. Muat ulang daftar.");
      const revoked = await client.query(
        `UPDATE exam_retake_permissions SET revoked_at=clock_timestamp(),revoked_by=$2::bigint
         WHERE id=$1::bigint AND revoked_at IS NULL AND consumed_at IS NULL RETURNING id`, [last.id, admin.id],
      );
      if (!revoked.rowCount) throw new RetakeProblem("Izin sudah berubah. Muat ulang daftar.");
      permissionId = last.id;
    }
    await client.query(
      `INSERT INTO exam_retake_operations(operation_id,attempt_id,action,result,permission_id)
       VALUES($1::uuid,$2::bigint,$3,'applied',$4::bigint)`, [operationId, attempt.id, operation, permissionId],
    );
    const stillActive = await lockActiveAdminSession(client);
    if (!stillActive || stillActive.id !== admin.id || !adminHasPermission(stillActive, "grading_overrides.manage")) {
      throw new RetakeProblem("Sesi admin berakhir. Masuk kembali dan muat ulang.");
    }
    await client.query("COMMIT"); transactionOpen = false;
    revalidatePath("/data-tes/monitoring");
    revalidatePath("/peserta");
    return { ok: true, message: operation === "grant" ? "Satu izin mengulang diberikan." : "Izin mengulang dicabut sebelum digunakan." };
  } catch (error) {
    if (client && transactionOpen && operationLocked && error instanceof RetakeProblem) {
      try {
        await client.query("ROLLBACK TO SAVEPOINT retake_decision");
        await client.query(
          `INSERT INTO exam_retake_operations(operation_id,attempt_id,action,result)
           VALUES($1::uuid,$2::bigint,$3,'cancelled') ON CONFLICT (operation_id) DO NOTHING`, [operationId, attemptId, operation],
        );
        await client.query("COMMIT"); transactionOpen = false;
        return { ok: false, error: error.message };
      } catch {
        await client.query("ROLLBACK").catch(() => {}); transactionOpen = false;
        return { ok: false, error: "Hasil tindakan belum dapat dipastikan. Periksa dan amankan permintaan sebelum melanjutkan.", uncertain: true };
      }
    }
    if (client && transactionOpen) await client.query("ROLLBACK").catch(() => {});
    // Sesi yang berakhir sebelum memperoleh lock tidak boleh memagari UUID
    // tanpa otorisasi; simpan identitas di tab agar admin dapat masuk kembali
    // lalu menyelesaikan pemulihan secara sah.
    if (error instanceof RetakeProblem) return { ok: false, error: error.message, uncertain: true };
    return { ok: false, error: "Hasil tindakan belum dapat dipastikan. Periksa dan amankan permintaan sebelum melanjutkan.", uncertain: true };
  } finally { client?.release(); }
}


/**
 * Jika tindakan sudah commit, laporkan izin yang terdampak. Jika belum, catat
 * pembatalan di bawah lock UUID yang sama; request terlambat tidak dapat lagi
 * mengubah izin. Aman diulang jika respons pemeriksaan juga hilang.
 */
export async function resolveRetakeOperation(form: FormData): Promise<RetakeResolveResult> {
  const session = await getAdminSession();
  if (session && !adminHasPermission(session, "grading_overrides.manage")) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  }
  if (!(form instanceof FormData) || ["operationId", "attemptId", "operation"].some((field) => form.getAll(field).length !== 1)) {
    return { ok: false, error: "Identitas permintaan tidak valid. Jangan mengubah izin sebelum memeriksanya." };
  }
  const operationId = validTokenOperationId(form.get("operationId"));
  const attemptId = validDataId(form.get("attemptId"));
  const action = form.get("operation");
  if (!operationId || !attemptId || (action !== "grant" && action !== "revoke")) {
    return { ok: false, error: "Identitas permintaan tidak valid. Jangan mengubah izin sebelum memeriksanya." };
  }
  let client: PoolClient | undefined; let transactionOpen = false;
  try {
    client = await getPostgresPool().connect(); await client.query("BEGIN"); transactionOpen = true;
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new RetakeProblem("Sesi admin berakhir. Masuk kembali di tab ini untuk memeriksa permintaan.");
    if (!adminHasPermission(admin, "grading_overrides.manage")) throw new RetakeProblem(PERMISSION_DENIED_MESSAGE);
    await lockOperation(client, operationId);
    const previous = await readOperation(client, operationId);
    if (previous && (previous.attemptId !== attemptId || previous.action !== action)) throw new RetakeProblem("Identitas permintaan tidak cocok. Hubungi pengelola sebelum melanjutkan.");
    if (!previous) {
      await client.query(
        `INSERT INTO exam_retake_operations(operation_id,attempt_id,action,result)
         VALUES($1::uuid,$2::bigint,$3,'cancelled')`, [operationId, attemptId, action],
      );
    }
    const stillActive = await lockActiveAdminSession(client);
    if (!stillActive || stillActive.id !== admin.id) throw new RetakeProblem("Sesi admin berakhir. Masuk kembali di tab ini untuk memeriksa permintaan.");
    await client.query("COMMIT"); transactionOpen = false;
    return { ok: true, outcome: previous?.result ?? "cancelled", permissionId: previous?.permissionId ?? null };
  } catch (error) {
    if (client && transactionOpen) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof RetakeProblem) return { ok: false, error: error.message };
    return { ok: false, error: "Hasil belum dapat diamankan. Periksa koneksi dan coba lagi; jangan mengubah izin sebelum selesai." };
  } finally { client?.release(); }
}
