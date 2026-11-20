import "server-only";

import { cookies } from "next/headers";
import type { PoolClient } from "pg";

import { participantSessionDigest } from "@/lib/participant-login-validation.mjs";

export type ParticipantCandidate = { identityId: string; studentId: string; periodId: string; placementId: string };
export type LockedParticipant = ParticipantCandidate & {
  studentName: string; participantNumber: string; className: string;
};

/** Cookie peserta dibatasi pada /peserta; jangan mengembalikan token mentah. */
export async function participantSessionHash() {
  return participantSessionDigest((await cookies()).get("nusacbt_participant_session")?.value);
}

/**
 * Panggil dalam transaksi. Pengaturan dikunci dahulu seperti saat login, agar
 * perubahan periode tidak berpacu dengan pemeriksaan/pengiriman jawaban.
 * Lookup awal hanya kandidat dan seluruh identitas diperiksa ulang setelah lock.
 */
export async function participantCandidate(client: PoolClient, hash: Buffer): Promise<ParticipantCandidate | null> {
  const settings = await client.query<{ periodId: string | null }>('SELECT period_id::text AS "periodId" FROM participant_login_settings WHERE id=1 FOR SHARE');
  if (settings.rowCount !== 1 || !settings.rows[0].periodId) return null;
  const found = await client.query<ParticipantCandidate>(
    `SELECT i.id::text AS "identityId",i.student_id::text AS "studentId",i.period_id::text AS "periodId",s.placement_id::text AS "placementId"
     FROM participant_sessions s JOIN participant_identities i ON i.id=s.participant_identity_id
     WHERE s.token_hash=$1 AND i.period_id=$2::bigint`, [hash, settings.rows[0].periodId],
  );
  return found.rows[0] ?? null;
}

/**
 * Urutan lock sama dengan login dan mutasi identitas: siswa, periode,
 * penempatan, identitas, sandi, kemudian sesi. Caller yang juga mengunci tes
 * harus mengunci tes/pelaksanaan SEBELUM memanggil fungsi ini.
 */
export async function lockParticipantSession(client: PoolClient, hash: Buffer, c: ParticipantCandidate): Promise<LockedParticipant | null> {
  const rows: Array<[string, string]> = [
    ["SELECT id FROM school_students WHERE id=$1::bigint FOR SHARE", c.studentId],
    ["SELECT id FROM exam_periods WHERE id=$1::bigint FOR SHARE", c.periodId],
    ["SELECT id FROM student_class_placements WHERE id=$1::bigint FOR SHARE", c.placementId],
    ["SELECT id FROM participant_identities WHERE id=$1::bigint FOR SHARE", c.identityId],
    ["SELECT participant_identity_id FROM participant_passwords WHERE participant_identity_id=$1::bigint FOR SHARE", c.identityId],
  ];
  for (const [sql, id] of rows) if ((await client.query(sql, [id])).rowCount !== 1) return null;
  const result = await client.query<LockedParticipant>(
    `SELECT i.id::text AS "identityId",i.student_id::text AS "studentId",i.period_id::text AS "periodId",
      pl.id::text AS "placementId",st.name AS "studentName",i.participant_number AS "participantNumber",pl.class_name_snapshot AS "className"
     FROM participant_sessions sess JOIN participant_identities i ON i.id=sess.participant_identity_id
     JOIN school_students st ON st.id=i.student_id
     JOIN participant_login_settings ls ON ls.id=1 AND ls.period_id=i.period_id
     JOIN student_class_placements pl ON pl.id=sess.placement_id AND pl.student_id=i.student_id AND pl.period_id=i.period_id AND pl.ended_at IS NULL
     JOIN participant_passwords pw ON pw.participant_identity_id=i.id
     WHERE sess.token_hash=$1 AND sess.expires_at>clock_timestamp()
       AND i.id=$2::bigint AND i.student_id=$3::bigint AND i.period_id=$4::bigint AND pl.id=$5::bigint
       AND i.username=sess.username_snapshot AND i.updated_at=sess.identity_revision
       AND pw.updated_at=sess.password_revision AND sha256(convert_to(pw.password_hash,'UTF8'))=sess.password_hash_digest
     FOR SHARE OF sess`, [hash, c.identityId, c.studentId, c.periodId, c.placementId],
  );
  return result.rows[0] ?? null;
}

/** Lock tetap ditahan, tetapi waktu sesi dapat habis saat transaksi menunggu. */
export async function participantSessionStillActive(client: PoolClient, hash: Buffer, c: ParticipantCandidate): Promise<boolean> {
  const result = await client.query<{ active: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM participant_sessions sess
      JOIN participant_identities i ON i.id=sess.participant_identity_id
      JOIN participant_login_settings ls ON ls.id=1 AND ls.period_id=i.period_id
      JOIN student_class_placements pl ON pl.id=sess.placement_id AND pl.student_id=i.student_id AND pl.period_id=i.period_id AND pl.ended_at IS NULL
      JOIN participant_passwords pw ON pw.participant_identity_id=i.id
      WHERE sess.token_hash=$1 AND sess.expires_at>clock_timestamp()
        AND i.id=$2::bigint AND i.student_id=$3::bigint AND i.period_id=$4::bigint AND pl.id=$5::bigint
        AND i.username=sess.username_snapshot AND i.updated_at=sess.identity_revision
        AND pw.updated_at=sess.password_revision AND sha256(convert_to(pw.password_hash,'UTF8'))=sess.password_hash_digest) AS active`,
    [hash, c.identityId, c.studentId, c.periodId, c.placementId],
  );
  return result.rows[0].active;
}
