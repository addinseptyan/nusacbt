"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { getAdminSession, lockActiveAdminSession, PERMISSION_DENIED_MESSAGE } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { validDataId } from "@/lib/class-validation.mjs";
import { examAnswerRevision } from "@/lib/exam-attempt-validation.mjs";
import { calculateFinalGrade, type FinalGradeMethod } from "@/lib/exam-final-grade.mjs";
import { finalGradeEvidenceDigest, lockFinalGradePair, type FinalEvidence } from "@/lib/exam-final-grade-server";
import { validTokenOperationId } from "@/lib/exam-token-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";

export type FinalGradeAction = "method" | "finalize" | "reopen";
export type FinalGradeResult = { ok: true; message: string } | { ok: false; error: string; uncertain?: boolean };
export type FinalGradeResolveResult = { ok: true; outcome: "applied" | "cancelled" } | { ok: false; error: string };
class GradeProblem extends Error {}

type Operation = { testId: string; identityId: string | null; action: FinalGradeAction; result: "applied" | "cancelled"; newValue: string | null };
type StoredAttempt = { id: string; kind: FinalEvidence["kind"]; correctCount: number | null; questionCount: number; completed: boolean };

async function lockOperation(client: PoolClient, operationId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('nusacbt:final-operation:' || $1::text, 0))", [operationId]);
}
async function readOperation(client: PoolClient, operationId: string) {
  return (await client.query<Operation>(
    `SELECT exam_test_id::text AS "testId",participant_identity_id::text AS "identityId",action,result,new_value AS "newValue"
     FROM exam_final_grade_operations WHERE operation_id=$1::uuid`, [operationId],
  )).rows[0] ?? null;
}
function actionTarget(form: FormData) {
  if (["operationId", "testId", "identityId", "operation"].some((field) => form.getAll(field).length !== 1)) return null;
  const operationId = validTokenOperationId(form.get("operationId"));
  const testId = validDataId(form.get("testId"));
  const operation = form.get("operation"); const rawIdentity = form.get("identityId");
  const identityId = rawIdentity === "" ? null : validDataId(rawIdentity);
  if (!operationId || !testId || (operation !== "method" && operation !== "finalize" && operation !== "reopen") ||
    (operation === "method" ? rawIdentity !== "" : !identityId)) return null;
  return { operationId, testId, identityId, operation };
}

/**
 * Semua input dari dialog hanyalah harapan, bukan otorisasi. Tes mengunci
 * perubahan metode terhadap mulai/penetapan; pasangan tes-identitas mengunci
 * mulai pertama, pengulangan, izin, dan penetapan di seluruh pelaksanaan.
 */
export async function changeFinalGrade(form: FormData): Promise<FinalGradeResult> {
  const session = await getAdminSession();
  if (session && !adminHasPermission(session, "grading_overrides.manage")) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  }
  if (!(form instanceof FormData)) return { ok: false, error: "Data nilai tidak valid. Muat ulang." };
  const target = actionTarget(form);
  if (!target || ["expectedRevision", "expectedMethodRevision", "expectedDigest", "targetMethod"].some((field) => form.getAll(field).length !== 1)) {
    return { ok: false, error: "Data nilai tidak valid. Muat ulang." };
  }
  const { operationId, testId, identityId, operation } = target;
  const expectedRevision = examAnswerRevision(form.get("expectedRevision"));
  const expectedMethodRevision = examAnswerRevision(form.get("expectedMethodRevision"));
  const digest = form.get("expectedDigest"); const desired = form.get("targetMethod");
  if (expectedRevision === null || expectedMethodRevision === null || typeof digest !== "string" || typeof desired !== "string" ||
    (operation === "method" ? (desired !== "highest" && desired !== "average") || digest !== "" :
      desired !== "" || !/^[a-f0-9]{64}$/.test(digest))) {
    return { ok: false, error: "Data nilai tidak valid. Muat ulang." };
  }

  let client: PoolClient | undefined; let transactionOpen = false; let operationLocked = false;
  try {
    client = await getPostgresPool().connect(); await client.query("BEGIN"); transactionOpen = true;
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new GradeProblem("Sesi admin berakhir. Masuk kembali dan muat ulang.");
    if (!adminHasPermission(admin, "grading_overrides.manage")) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return { ok: false, error: PERMISSION_DENIED_MESSAGE };
    }
    await lockOperation(client, operationId);
    await client.query("SAVEPOINT final_decision"); operationLocked = true;
    const prior = await readOperation(client, operationId);
    if (prior) {
      if (prior.testId !== testId || prior.identityId !== identityId || prior.action !== operation ||
          (prior.result === "applied" && operation === "method" && prior.newValue !== desired)) throw new GradeProblem("Identitas permintaan tidak cocok. Muat ulang.");
      if (prior.result === "cancelled") throw new GradeProblem("Permintaan sudah diamankan dan tidak dapat dijalankan. Muat ulang.");
      const active = await lockActiveAdminSession(client);
      if (!active || active.id !== admin.id) throw new GradeProblem("Sesi admin berakhir. Masuk kembali dan muat ulang.");
      await client.query("COMMIT"); transactionOpen = false;
      return { ok: true, message: "Tindakan ini sudah diproses. Muat ulang untuk melihat status terkini." };
    }

    // Perubahan metode menunggu semua penetapan dan mulai yang memegang SHARE;
    // selama metode berubah, transaksi lain menunggu sebelum membaca metode.
    const tests = await client.query<{ periodId: string }>(
      `SELECT period_id::text AS "periodId" FROM exam_tests WHERE id=$1::bigint ${operation === "method" ? "FOR UPDATE" : "FOR SHARE"}`, [testId],
    );
    if (!tests.rowCount) throw new GradeProblem("Tes tidak ditemukan. Muat ulang daftar.");
    const settings = await client.query<{ method: FinalGradeMethod; revision: string }>(
      `SELECT COALESCE(s.method,'highest') AS method,COALESCE(s.revision,0)::text AS revision
       FROM exam_tests t LEFT JOIN exam_final_grade_settings s ON s.exam_test_id=t.id WHERE t.id=$1::bigint`, [testId],
    );
    const setting = settings.rows[0];
    if (!setting) throw new GradeProblem("Tes berubah. Muat ulang daftar.");

    let message: string;
    if (operation === "method") {
      if (setting.revision !== expectedRevision || setting.revision !== expectedMethodRevision) throw new GradeProblem("Metode tes sudah berubah. Muat ulang sebelum melanjutkan.");
      if (desired === setting.method) throw new GradeProblem("Metode tidak berubah. Muat ulang daftar.");
      const changed = await client.query<{ revision: string }>(
        `INSERT INTO exam_final_grade_settings(exam_test_id,method,revision,updated_by)
         VALUES($1::bigint,$2,1,$3::bigint)
         ON CONFLICT(exam_test_id) DO UPDATE SET method=EXCLUDED.method,revision=exam_final_grade_settings.revision+1,
           updated_at=clock_timestamp(),updated_by=EXCLUDED.updated_by RETURNING revision::text AS revision`, [testId, desired, admin.id],
      );
      await client.query(
        `INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,action,result,old_value,new_value,revision,actor_id)
         VALUES($1::uuid,$2::bigint,'method','applied',$3,$4,$5::bigint,$6::bigint)`,
        [operationId, testId, setting.method, desired, changed.rows[0].revision, admin.id],
      );
      message = "Metode tes diubah. Nilai akhir yang telah ditetapkan dihitung kembali dengan metode baru.";
    } else {
      if (!identityId) throw new GradeProblem("Peserta tidak ditemukan. Muat ulang.");
      await lockFinalGradePair(client, testId, identityId);
      if (setting.revision !== expectedMethodRevision) throw new GradeProblem("Metode tes sudah berubah. Muat ulang dan periksa nilai kembali.");
      const state = (await client.query<{ revision: string; finalized: boolean }>(
        `SELECT revision::text AS revision,finalized_at IS NOT NULL AS finalized FROM exam_final_grade_state
         WHERE exam_test_id=$1::bigint AND participant_identity_id=$2::bigint`, [testId, identityId],
      )).rows[0] ?? { revision: "0", finalized: false };
      if (state.revision !== expectedRevision || state.finalized !== (operation === "reopen")) {
        throw new GradeProblem("Status nilai akhir sudah berubah. Muat ulang dan periksa kembali.");
      }
      const attempts = (await client.query<StoredAttempt>(
        `SELECT id::text AS id,kind,correct_count AS "correctCount",question_count AS "questionCount",completed_at IS NOT NULL AS completed
         FROM exam_attempts WHERE exam_test_id=$1::bigint AND participant_identity_id=$2::bigint ORDER BY id`, [testId, identityId],
      )).rows;
      const finished: FinalEvidence[] = attempts.filter((item) => item.completed && item.correctCount !== null).map((item) => ({
        id: item.id, kind: item.kind, correctCount: item.correctCount!, questionCount: item.questionCount,
      }));
      if (!finished.length) throw new GradeProblem("Belum ada pengerjaan selesai untuk dinilai. Muat ulang daftar.");
      if (operation === "finalize" && attempts.some((item) => !item.completed)) {
        throw new GradeProblem("Masih ada pengerjaan yang belum selesai atau menunggu penyelesaian otomatis. Tunggu sampai selesai lalu muat ulang.");
      }
      if (finalGradeEvidenceDigest(finished) !== digest) throw new GradeProblem("Daftar atau nilai pengerjaan sudah berubah. Muat ulang dan periksa kembali.");
      const score = calculateFinalGrade(setting.method, finished);
      if (score === null) throw new GradeProblem("Data nilai pengerjaan tidak konsisten. Hubungi pengelola.");
      let revoked = 0;
      if (operation === "finalize") {
        // Seluruh izin belum dipakai, termasuk yang telah melewati jadwal,
        // dicabut agar tidak hidup lagi saat nilai dibuka kembali.
        const result = await client.query(
          `UPDATE exam_retake_permissions p SET revoked_at=clock_timestamp(),revoked_by=$3::bigint
           FROM exam_schedule_runs r WHERE p.run_id=r.id AND r.exam_test_id=$1::bigint
             AND p.participant_identity_id=$2::bigint AND p.revoked_at IS NULL AND p.consumed_at IS NULL`, [testId, identityId, admin.id],
        );
        revoked = result.rowCount ?? 0;
      }
      const updated = await client.query<{ revision: string }>(
        `INSERT INTO exam_final_grade_state(exam_test_id,participant_identity_id,period_id,finalized_at,finalized_by,revision,updated_by)
         VALUES($1::bigint,$2::bigint,$3::bigint,CASE WHEN $4::boolean THEN clock_timestamp() ELSE NULL END,
           CASE WHEN $4::boolean THEN $5::bigint ELSE NULL END,1,$5::bigint)
         ON CONFLICT(exam_test_id,participant_identity_id) DO UPDATE SET
           finalized_at=CASE WHEN $4::boolean THEN clock_timestamp() ELSE NULL END,
           finalized_by=CASE WHEN $4::boolean THEN $5::bigint ELSE NULL END,
           revision=exam_final_grade_state.revision+1,updated_at=clock_timestamp(),updated_by=$5::bigint
         RETURNING revision::text AS revision`, [testId, identityId, tests.rows[0].periodId, operation === "finalize", admin.id],
      );
      await client.query(
        `INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,participant_identity_id,action,result,old_value,new_value,revision,
          revoked_permissions,recorded_method,recorded_hundredths,recorded_attempt_count,recorded_attempt_ids,actor_id)
         VALUES($1::uuid,$2::bigint,$3::bigint,$4,'applied',$5,$6,$7::bigint,$8::integer,$9,$10::integer,$11::integer,$12::bigint[],$13::bigint)`,
        [operationId, testId, identityId, operation, operation === "finalize" ? "open" : "final", operation === "finalize" ? "final" : "open",
          updated.rows[0].revision, revoked, setting.method, Math.round(score * 100), finished.length, finished.map((item) => item.id), admin.id],
      );
      message = operation === "finalize" ? `Nilai akhir ditetapkan. ${revoked} izin belum dipakai dicabut.` :
        "Nilai dibuka kembali dan menjadi sementara. Izin yang pernah dicabut tidak otomatis dipulihkan.";
    }
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id || !adminHasPermission(active, "grading_overrides.manage")) {
      throw new GradeProblem("Sesi admin berakhir. Masuk kembali dan muat ulang.");
    }
    await client.query("COMMIT"); transactionOpen = false;
    revalidatePath("/data-tes/monitoring"); revalidatePath("/peserta"); revalidatePath("/peserta/nilai");
    return { ok: true, message };
  } catch (error) {
    if (client && transactionOpen && operationLocked && error instanceof GradeProblem) {
      try {
        await client.query("ROLLBACK TO SAVEPOINT final_decision");
        await client.query(
          `INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,participant_identity_id,action,result)
           VALUES($1::uuid,$2::bigint,$3::bigint,$4,'cancelled') ON CONFLICT(operation_id) DO NOTHING`, [operationId, testId, identityId, operation],
        );
        await client.query("COMMIT"); transactionOpen = false;
        return { ok: false, error: error.message };
      } catch {
        await client.query("ROLLBACK").catch(() => {}); transactionOpen = false;
        return { ok: false, error: "Hasil belum dapat dipastikan. Periksa dan amankan permintaan sebelum melanjutkan.", uncertain: true };
      }
    }
    if (client && transactionOpen) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof GradeProblem) return { ok: false, error: error.message, uncertain: true };
    return { ok: false, error: "Hasil belum dapat dipastikan. Periksa dan amankan permintaan sebelum melanjutkan.", uncertain: true };
  } finally { client?.release(); }
}

/** Memagari request terlambat, atau melaporkan operasi yang sudah commit. */
export async function resolveFinalGradeOperation(form: FormData): Promise<FinalGradeResolveResult> {
  const session = await getAdminSession();
  if (session && !adminHasPermission(session, "grading_overrides.manage")) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  }
  const target = form instanceof FormData ? actionTarget(form) : null;
  if (!target) return { ok: false, error: "Identitas permintaan tidak valid. Jangan mengubah nilai sebelum memeriksanya." };
  const { operationId, testId, identityId, operation } = target;
  let client: PoolClient | undefined; let transactionOpen = false;
  try {
    client = await getPostgresPool().connect(); await client.query("BEGIN"); transactionOpen = true;
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new GradeProblem("Sesi admin berakhir. Masuk kembali di tab ini.");
    if (!adminHasPermission(admin, "grading_overrides.manage")) throw new GradeProblem(PERMISSION_DENIED_MESSAGE);
    await lockOperation(client, operationId);
    const prior = await readOperation(client, operationId);
    if (prior && (prior.testId !== testId || prior.identityId !== identityId || prior.action !== operation)) throw new GradeProblem("Identitas permintaan tidak cocok. Hubungi pengelola.");
    if (!prior) {
      // Jejak tidak bergantung pada keberadaan tes/identitas saat ini; tetap
      // memagari request terlambat bahkan setelah tes draf dihapus.
      await client.query(
        `INSERT INTO exam_final_grade_operations(operation_id,exam_test_id,participant_identity_id,action,result)
         VALUES($1::uuid,$2::bigint,$3::bigint,$4,'cancelled')`, [operationId, testId, identityId, operation],
      );
    }
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new GradeProblem("Sesi admin berakhir. Masuk kembali di tab ini.");
    await client.query("COMMIT"); transactionOpen = false;
    return { ok: true, outcome: prior?.result ?? "cancelled" };
  } catch (error) {
    if (client && transactionOpen) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof GradeProblem) return { ok: false, error: error.message };
    return { ok: false, error: "Hasil belum dapat diamankan. Periksa koneksi dan coba lagi." };
  } finally { client?.release(); }
}
