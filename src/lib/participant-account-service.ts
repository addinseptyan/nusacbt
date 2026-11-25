import "server-only";

import { lockActiveAdminSession, PERMISSION_DENIED_MESSAGE } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { validDataId } from "@/lib/class-validation.mjs";
import type { AccountPageData, LoginLock } from "@/lib/participant-account-types";
import { loadIdentityPageWithClient } from "@/lib/participant-identity-service";
import { validateParticipantUsername } from "@/lib/participant-identity-validation.mjs";
import { participantAttemptBucket } from "@/lib/participant-login-validation.mjs";
import { loadPasswordPageWithClient } from "@/lib/participant-password-service";
import { getPostgresPool } from "@/lib/postgres";
import { validTopicRevision as validRowRevision } from "@/lib/topic-validation.mjs";

class UnlockProblem extends Error {}
const BUCKET_PREFIX = Buffer.from("NusaCBT participant login v1\0", "utf8");
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Identitas, sandi tersamarkan, dan status kunci diambil dari satu snapshot. */
export async function loadAccountPage(
  periodId: string | null,
  options?: { defaultToFirst?: boolean },
): Promise<AccountPageData> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const identities = await loadIdentityPageWithClient(client, periodId, options);
    const passwords = await loadPasswordPageWithClient(client, periodId, options);
    if (identities.selected?.id !== passwords.selected?.id) throw new Error("Snapshot periode tidak konsisten.");
    const passwordRows = new Map(passwords.rows.map((row) => [row.identityId, row]));
    const identitiesWithAccount = identities.rows.filter((row) => row.identityId);
    if (identitiesWithAccount.length !== passwords.rows.length || identitiesWithAccount.some((row) => {
      const password = passwordRows.get(row.identityId!);
      return !password || password.studentId !== row.studentId || password.username !== row.username ||
        password.participantNumber !== row.participantNumber || password.identityVersion !== row.identityVersion ||
        password.studentVersion !== row.studentVersion || password.placementId !== row.placementId;
    })) throw new Error("Snapshot akun tidak konsisten.");
    let locks: LoginLock[] = [];
    if (identities.selected) {
      // Bentuk digest identik dengan participantAttemptBucket; tidak memuat
      // sandi, hash sandi, ciphertext, token sesi, atau isi kunci ke halaman.
      const result = await client.query<LoginLock>(
        `SELECT i.id::text AS "identityId", i.student_id::text AS "studentId", i.username,
          i.xmin::text AS "identityRevision", s.xmin::text AS "studentRevision", e.xmin::text AS "periodRevision",
          to_char(a.locked_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "lockedUntil"
         FROM participant_identities i
         JOIN school_students s ON s.id = i.student_id JOIN exam_periods e ON e.id = i.period_id
         JOIN participant_login_attempts a ON a.bucket_hash = sha256(
           $2::bytea || convert_to(i.period_id::text, 'UTF8') || decode('00','hex') || convert_to(lower(i.username COLLATE "C"), 'UTF8')
         )
         WHERE i.period_id = $1::bigint AND a.locked_until > statement_timestamp()`,
        [identities.selected.id, BUCKET_PREFIX],
      );
      locks = result.rows;
    }
    await client.query("COMMIT");
    return { identities, passwords, locks };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

function singleString(form: FormData, name: string) {
  const values = form.getAll(name);
  if (values.length !== 1 || typeof values[0] !== "string") throw new UnlockProblem("Permintaan tidak valid. Muat ulang halaman.");
  return values[0];
}

/**
 * Hanya membuka satu penguncian aktif, tanpa memerlukan kunci sandi dan tanpa
 * mengubah sandi/sesi/pembatas global. Audit dan update dalam satu transaksi.
 */
export async function unlockParticipantLogin(form: FormData): Promise<string> {
  const identityId = validDataId(singleString(form, "identityId"));
  const studentId = validDataId(singleString(form, "studentId"));
  const periodId = validDataId(singleString(form, "periodId"));
  const username = singleString(form, "username");
  const checkedUsername = validateParticipantUsername(username);
  const identityRevision = validRowRevision(singleString(form, "identityRevision"));
  const studentRevision = validRowRevision(singleString(form, "studentRevision"));
  const periodRevision = validRowRevision(singleString(form, "periodRevision"));
  const lockedUntil = singleString(form, "lockedUntil");
  if (!identityId || !studentId || !periodId || !checkedUsername.ok || checkedUsername.value !== username ||
      !identityRevision || !studentRevision || !periodRevision || !TIMESTAMP.test(lockedUntil)) {
    throw new UnlockProblem("Data akun tidak valid. Muat ulang halaman.");
  }
  const bucket = participantAttemptBucket(periodId, username.toLowerCase());
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new UnlockProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    if (!adminHasPermission(admin, "participant_accounts.manage")) throw new UnlockProblem(PERMISSION_DENIED_MESSAGE);

    // Login menahan bucket sebelum siswa/periode/identitas. Urutan yang sama
    // mencegah kebuntuan dan memastikan login yang bersamaan tidak hilang.
    const attempts = await client.query<{ active: boolean; lockedUntil: string | null }>(
      `SELECT locked_until > clock_timestamp() AS active,
        to_char(locked_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "lockedUntil"
       FROM participant_login_attempts WHERE bucket_hash=$1 FOR UPDATE`, [bucket],
    );
    if (!attempts.rowCount || !attempts.rows[0].active || attempts.rows[0].lockedUntil !== lockedUntil) {
      throw new UnlockProblem("Penguncian sudah berakhir atau berubah. Muat ulang daftar sebelum mencoba lagi.");
    }
    const student = await client.query<{ revision: string }>("SELECT xmin::text AS revision FROM school_students WHERE id=$1::bigint FOR SHARE", [studentId]);
    const period = await client.query<{ revision: string }>("SELECT xmin::text AS revision FROM exam_periods WHERE id=$1::bigint FOR SHARE", [periodId]);
    const identity = await client.query<{ revision: string; studentId: string; periodId: string; username: string }>(
      `SELECT xmin::text AS revision, student_id::text AS "studentId", period_id::text AS "periodId", username
       FROM participant_identities WHERE id=$1::bigint FOR SHARE`, [identityId],
    );
    const row = identity.rows[0];
    if (!student.rowCount || student.rows[0].revision !== studentRevision || !period.rowCount || period.rows[0].revision !== periodRevision ||
        !row || row.revision !== identityRevision || row.studentId !== studentId || row.periodId !== periodId || row.username !== username) {
      throw new UnlockProblem("Data peserta atau periode sudah berubah. Muat ulang daftar sebelum membuka kunci.");
    }
    const updated = await client.query(
      "UPDATE participant_login_attempts SET failed_attempts=0, locked_until=NULL, last_attempt_at=clock_timestamp() WHERE bucket_hash=$1 AND locked_until > clock_timestamp() RETURNING bucket_hash", [bucket],
    );
    if (!updated.rowCount) throw new UnlockProblem("Penguncian sudah berakhir. Muat ulang daftar sebelum mencoba lagi.");
    await client.query("INSERT INTO participant_password_audit(participant_identity_id,admin_id,event) VALUES($1::bigint,$2::bigint,'unlock_login')", [identityId, admin.id]);
    const stillActive = await lockActiveAdminSession(client);
    if (!stillActive || stillActive.id !== admin.id) throw new UnlockProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    await client.query("COMMIT");
    return "Kunci login peserta dibuka. Sandi tidak diubah.";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

export function unlockErrorMessage(error: unknown) {
  return error instanceof UnlockProblem ? error.message : "Hasil pembukaan kunci belum dapat dipastikan. Periksa sesi dan koneksi, lalu muat ulang daftar.";
}
