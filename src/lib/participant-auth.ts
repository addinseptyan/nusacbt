import "server-only";

import { randomBytes, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import type { PoolClient } from "pg";

import { participantAttemptBucket, participantSessionDigest } from "@/lib/participant-login-validation.mjs";
import { verifyPassword } from "@/lib/password.mjs";
import { getPostgresPool } from "@/lib/postgres";

const COOKIE_NAME = "nusacbt_participant_session";
const COOKIE_PATH = "/peserta";
const SESSION_SECONDS = 8 * 60 * 60;
const PAGE_SIZE = 20;
const HASH_FORMAT = /^scrypt\$32768\$8\$3\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/;
// Dummy publik memastikan akun/identitas tanpa sandi juga melalui scrypt.
const DUMMY_HASH = "scrypt$32768$8$3$bnVzYWNidC1kdW1teS12MQ$Raa-ekVKy8Za16jY9UvGVQe7QgcE8qumcVaR-QYwcSlPWOICqa72jz34cvRzGMbcqD08s2eMvJpOmu-lx5iNfA";

type Credentials = { username: string; password: string };
type ScopedCredentials = Credentials & { periodId: string };
type IdentityLookup = { id: string; studentId: string };
type LockedIdentity = { id: string; username: string };
type PasswordRow = { passwordHash: string };
type AttemptRow = { failedAttempts: number; locked: boolean; lockExpired: boolean };

export type ParticipantSchedule = {
  id: string; name: string; startLocal: string; endLocal: string; zone: "WIB" | "WITA" | "WIT";
  durationMinutes: number; status: "Belum dimulai" | "Berlangsung" | "Berakhir";
};
export type ParticipantView = {
  studentName: string; username: string; participantNumber: string; className: string; periodName: string;
  total: number; page: number; pages: number; tests: ParticipantSchedule[];
};

export function participantCookieSecure() {
  const setting = process.env.NUSACBT_COOKIE_SECURE;
  if (!setting) return process.env.NODE_ENV === "production";
  if (setting === "true") return true;
  if (setting === "false") return false;
  throw new Error("NUSACBT_COOKIE_SECURE harus true atau false.");
}

async function globalAttemptSlot() {
  // Satu UPDATE atomik berlaku di semua proses aplikasi yang memakai database
  // ini. 180 permintaan per menit bersifat global, bukan batas per IP.
  const result = await getPostgresPool().query<{ allowed: boolean }>(
    `WITH moment AS (SELECT clock_timestamp() AS current_time)
     UPDATE participant_login_global_limit AS l
     SET window_started_at = CASE WHEN l.window_started_at <= moment.current_time - interval '1 minute'
       OR l.window_started_at > moment.current_time THEN moment.current_time ELSE l.window_started_at END,
       attempts = CASE WHEN l.window_started_at <= moment.current_time - interval '1 minute'
       OR l.window_started_at > moment.current_time THEN 1 ELSE LEAST(l.attempts + 1, 181) END
     FROM moment WHERE l.id = 1 RETURNING l.attempts <= 180 AS allowed`,
  );
  if (result.rowCount !== 1) throw new Error("Pembatas login peserta tidak tersedia.");
  return result.rows[0].allowed;
}

async function pruneOldAuthRows() {
  // Pembersihan dibatasi dan melewati baris yang sedang digunakan. Bucket
  // tetap ada setidaknya 24 jam; pembersihan hanya terjadi saat ada login.
  const pool = getPostgresPool();
  await pool.query(
    `DELETE FROM participant_login_attempts WHERE bucket_hash IN (
       SELECT bucket_hash FROM participant_login_attempts
       WHERE last_attempt_at < clock_timestamp() - interval '24 hours'
         AND (locked_until IS NULL OR locked_until < clock_timestamp())
       ORDER BY last_attempt_at LIMIT 2000 FOR UPDATE SKIP LOCKED
     )`,
  );
  await pool.query(
    `DELETE FROM participant_sessions WHERE token_hash IN (
       SELECT token_hash FROM participant_sessions WHERE expires_at <= clock_timestamp()
       ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED
     )`,
  );
}

async function lockIdentityRows(client: PoolClient, credentials: ScopedCredentials) {
  // Urutannya sama dengan layanan identitas/sandi: siswa, periode,
  // penempatan, identitas, sandi. Lookup awal hanya untuk menemukan siswa;
  // identitas dan username diperiksa lagi setelah penguncian.
  const lookup = await client.query<IdentityLookup>(
    `SELECT id::text AS id, student_id::text AS "studentId"
     FROM participant_identities WHERE period_id = $1::bigint AND lower(username COLLATE "C") = $2`,
    [credentials.periodId, credentials.username],
  );
  if (!lookup.rows[0]) return null;
  const candidate = lookup.rows[0];
  const student = await client.query("SELECT id FROM school_students WHERE id = $1::bigint FOR SHARE", [candidate.studentId]);
  const period = await client.query("SELECT id FROM exam_periods WHERE id = $1::bigint FOR SHARE", [credentials.periodId]);
  const placement = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM student_class_placements
     WHERE student_id = $1::bigint AND period_id = $2::bigint AND ended_at IS NULL FOR SHARE`,
    [candidate.studentId, credentials.periodId],
  );
  const identity = await client.query<LockedIdentity>(
    `SELECT id::text AS id, username FROM participant_identities
     WHERE id = $1::bigint AND student_id = $2::bigint AND period_id = $3::bigint
       AND lower(username COLLATE "C") = $4 FOR SHARE`,
    [candidate.id, candidate.studentId, credentials.periodId, credentials.username],
  );
  const password = await client.query<PasswordRow>(
    `SELECT password_hash AS "passwordHash" FROM participant_passwords
     WHERE participant_identity_id = $1::bigint FOR SHARE`, [candidate.id],
  );
  return {
    studentExists: student.rowCount === 1, periodExists: period.rowCount === 1,
    placement: placement.rows[0] ?? null, identity: identity.rows[0] ?? null, password: password.rows[0] ?? null,
  };
}

/** Sandi dan token mentah tidak ditulis ke log atau database. */
export async function authenticateParticipant(credentials: Credentials): Promise<string | null> {
  if (!await globalAttemptSlot()) return null;
  if (randomInt(16) === 0) await pruneOldAuthRows().catch(() => {});
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    // Tahan pengaturan sampai sesi diterbitkan. Penggantian periode menunggu
    // login yang sedang berjalan lalu menghapus semua sesi secara atomik.
    const setting = await client.query<{ periodId: string | null }>(
      'SELECT period_id::text AS "periodId" FROM participant_login_settings WHERE id = 1 FOR SHARE',
    );
    if (setting.rowCount !== 1) throw new Error("Pengaturan login peserta tidak tersedia.");
    const periodId = setting.rows[0].periodId;
    if (!periodId) { await client.query("COMMIT"); return null; }
    const scoped: ScopedCredentials = { ...credentials, periodId };
    const bucket = participantAttemptBucket(periodId, credentials.username);
    await client.query("INSERT INTO participant_login_attempts(bucket_hash) VALUES($1) ON CONFLICT (bucket_hash) DO NOTHING", [bucket]);
    const attempt = await client.query<AttemptRow>(
      `SELECT failed_attempts AS "failedAttempts", COALESCE(locked_until > clock_timestamp(), false) AS locked,
         COALESCE(locked_until <= clock_timestamp(), false) AS "lockExpired"
       FROM participant_login_attempts WHERE bucket_hash = $1 FOR UPDATE`, [bucket],
    );
    const state = attempt.rows[0];
    if (!state) throw new Error("Bucket login tidak tersedia.");
    if (state.locked) {
      await client.query("UPDATE participant_login_attempts SET last_attempt_at = clock_timestamp() WHERE bucket_hash = $1", [bucket]);
      await client.query("COMMIT");
      return null;
    }

    const records = await lockIdentityRows(client, scoped);
    const storedHash = records?.password?.passwordHash;
    const hashValid = typeof storedHash === "string" && HASH_FORMAT.test(storedHash);
    const matches = await verifyPassword(credentials.password, hashValid ? storedHash : DUMMY_HASH);
    if (!matches || !hashValid || !records?.studentExists || !records.periodExists || !records.placement || !records.identity) {
      const failures = (state.lockExpired ? 0 : state.failedAttempts) + 1;
      await client.query(
        `UPDATE participant_login_attempts SET failed_attempts = LEAST($2::integer, 5),
          locked_until = CASE WHEN $2::integer >= 5 THEN clock_timestamp() + interval '15 minutes' ELSE NULL END,
          last_attempt_at = clock_timestamp() WHERE bucket_hash = $1`, [bucket, failures],
      );
      await client.query("COMMIT");
      return null;
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = participantSessionDigest(token);
    if (!tokenHash) throw new Error("Token sesi tidak valid.");
    // Dengan UNIQUE per identitas, penerbitan baru menggantikan sesi lama.
    // Kunci identitas/sandi/penempatan ditahan sampai commit agar reset atau
    // pemindahan kelas yang bersamaan tidak menghasilkan sesi usang.
    await client.query("DELETE FROM participant_sessions WHERE participant_identity_id = $1::bigint", [records.identity.id]);
    const inserted = await client.query(
      `INSERT INTO participant_sessions(token_hash, participant_identity_id, placement_id, username_snapshot,
         identity_revision, password_revision, password_hash_digest, expires_at)
       SELECT $1::bytea, i.id, p.id, i.username, i.updated_at, pw.updated_at,
         sha256(convert_to(pw.password_hash, 'UTF8')), clock_timestamp() + interval '8 hours'
       FROM participant_identities i JOIN participant_passwords pw ON pw.participant_identity_id = i.id
       JOIN student_class_placements p ON p.id = $3::bigint AND p.student_id = i.student_id
         AND p.period_id = i.period_id AND p.ended_at IS NULL
       WHERE i.id = $2::bigint AND i.username = $4`,
      [tokenHash, records.identity.id, records.placement.id, records.identity.username],
    );
    if (inserted.rowCount !== 1) throw new Error("Sesi peserta tidak dapat diterbitkan.");
    await client.query(
      `UPDATE participant_login_attempts SET failed_attempts = 0, locked_until = NULL,
       last_attempt_at = clock_timestamp() WHERE bucket_hash = $1`, [bucket],
    );
    await client.query("COMMIT");
    return token;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function setParticipantSessionCookie(token: string, secure: boolean) {
  if (!participantSessionDigest(token)) throw new Error("Token sesi tidak valid.");
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true, secure, sameSite: "strict", path: COOKIE_PATH, maxAge: SESSION_SECONDS,
  });
}

export async function endParticipantSession() {
  const store = await cookies();
  const hash = participantSessionDigest(store.get(COOKIE_NAME)?.value);
  if (hash) await getPostgresPool().query("DELETE FROM participant_sessions WHERE token_hash = $1", [hash]);
  store.set(COOKIE_NAME, "", { httpOnly: true, secure: participantCookieSecure(), sameSite: "strict", path: COOKIE_PATH, maxAge: 0 });
}

export async function participantLoginEnabled(): Promise<boolean> {
  const result = await getPostgresPool().query<{ enabled: boolean }>(
    "SELECT period_id IS NOT NULL AS enabled FROM participant_login_settings WHERE id = 1",
  );
  if (result.rowCount !== 1) throw new Error("Pengaturan login peserta tidak tersedia.");
  return result.rows[0].enabled;
}

export async function participantView(requestedPage: number): Promise<ParticipantView | null> {
  const hash = participantSessionDigest((await cookies()).get(COOKIE_NAME)?.value);
  if (!hash) return null;
  // Profil dan jadwal diperoleh dalam SATU query, dibatasi oleh sesi aktif.
  // Tidak ada join ke soal, jawaban, token, atau data peserta lain.
  const result = await getPostgresPool().query<ParticipantView>(
    `WITH auth AS (
       SELECT i.period_id, st.name AS "studentName", i.username, i.participant_number AS "participantNumber",
         c.level || ' ' || m.name AS "className", ep.name AS "periodName"
       FROM participant_sessions sess
       JOIN participant_identities i ON i.id = sess.participant_identity_id
       JOIN school_students st ON st.id = i.student_id
       JOIN exam_periods ep ON ep.id = i.period_id
       JOIN participant_login_settings ls ON ls.id = 1 AND ls.period_id = i.period_id
       JOIN student_class_placements pl ON pl.id = sess.placement_id AND pl.student_id = i.student_id
         AND pl.period_id = i.period_id AND pl.ended_at IS NULL
       JOIN school_classes c ON c.id = pl.class_id JOIN school_majors m ON m.id = c.major_id
       JOIN participant_passwords pw ON pw.participant_identity_id = i.id
       WHERE sess.token_hash = $1 AND sess.expires_at > clock_timestamp()
         AND i.username = sess.username_snapshot AND i.updated_at = sess.identity_revision
         AND pw.updated_at = sess.password_revision AND sha256(convert_to(pw.password_hash, 'UTF8')) = sess.password_hash_digest
     ), counts AS (
       SELECT count(*)::int AS total FROM exam_tests e JOIN auth a ON e.period_id = a.period_id
     ), page_info AS (
       SELECT total, GREATEST(1, CEIL(total::numeric / $3::integer)::int) AS pages,
         LEAST($2::integer, GREATEST(1, CEIL(total::numeric / $3::integer)::int)) AS page FROM counts
     )
     SELECT a."studentName", a.username, a."participantNumber", a."className", a."periodName",
       pi.total, pi.page, pi.pages,
       COALESCE((SELECT json_agg(d) FROM (
         SELECT e.id::text AS id, e.name,
           to_char(e.starts_at AT TIME ZONE (CASE e.time_zone WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END), 'DD/MM/YYYY HH24:MI') AS "startLocal",
           to_char((e.starts_at + e.duration_minutes * interval '1 minute') AT TIME ZONE (CASE e.time_zone WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END), 'DD/MM/YYYY HH24:MI') AS "endLocal",
           e.time_zone AS zone, e.duration_minutes AS "durationMinutes",
           CASE WHEN e.starts_at > statement_timestamp() THEN 'Belum dimulai'
             WHEN e.starts_at + e.duration_minutes * interval '1 minute' > statement_timestamp() THEN 'Berlangsung'
             ELSE 'Berakhir' END AS status
         FROM exam_tests e WHERE e.period_id = a.period_id
         ORDER BY CASE WHEN e.starts_at <= statement_timestamp() AND e.starts_at + e.duration_minutes * interval '1 minute' > statement_timestamp() THEN 0
             WHEN e.starts_at > statement_timestamp() THEN 1 ELSE 2 END,
           CASE WHEN e.starts_at + e.duration_minutes * interval '1 minute' > statement_timestamp() THEN e.starts_at END ASC,
           CASE WHEN e.starts_at + e.duration_minutes * interval '1 minute' <= statement_timestamp() THEN e.starts_at END DESC, e.id DESC
         LIMIT $3::integer OFFSET ((pi.page - 1) * $3::integer)
       ) d), '[]'::json) AS tests
     FROM auth a CROSS JOIN page_info pi`,
    [hash, requestedPage, PAGE_SIZE],
  );
  return result.rows[0] ?? null;
}
