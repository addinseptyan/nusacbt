import "server-only";

import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { PoolClient } from "pg";

import { lockActiveAdminSession } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { lockSchedulePeriod } from "@/lib/exam-session-service";
import { PARTICIPANT_CARD_BATCH_SIZE } from "@/lib/participant-card-constants.mjs";
import type { CardFilters } from "@/lib/participant-card-filter.mjs";
import { cardFilterCondition, cardFilterValues } from "@/lib/participant-card-sql";
import type { PreparedCards } from "@/lib/participant-card-types";
import type { IdentityPeriod } from "@/lib/participant-identity-types";
import {
  decryptParticipantPassword,
  encryptParticipantPassword,
  generateParticipantPassword,
  ParticipantKeyFileError,
  participantKeyVerifier,
  readParticipantKeyFile,
  sameParticipantVerifier,
  validateParticipantPassword,
} from "@/lib/participant-password-crypto.mjs";
import { PARTICIPANT_PASSWORD_BATCH_SIZE } from "@/lib/participant-password-constants.mjs";
import type { PasswordAudit, PasswordCandidate, PasswordDisplayRow, PasswordKeyStatus, PasswordPageData, PasswordRow } from "@/lib/participant-password-types";
import { hashParticipantPassword } from "@/lib/password.mjs";
import { getPostgresPool } from "@/lib/postgres";

export class PasswordProblem extends Error {}

type Student = { id: string; name: string; nisn: string; version: string };
type Placement = { id: string; studentId: string; classId: string; classLabel: string };
type Identity = { id: string; studentId: string; participantNumber: string; username: string; version: string };
type PasswordMetadata = { identityId: string; version: string; revision: string };
type PasswordCiphertext = { identityId: string; nonce: Buffer; ciphertext: Buffer; authenticationTag: Buffer };
type PasswordPageRow = PasswordRow & { passwordRevision: string | null };
type PreparedPassword = { identityId: string; hash: string; nonce: Buffer; ciphertext: Buffer; authenticationTag: Buffer };

// Fingerprint mendeteksi halaman usang, bukan merupakan autentikasi atau rahasia.
function candidateToken(period: IdentityPeriod, row: PasswordRow, passwordRevision: string | null) {
  return createHash("sha256").update(JSON.stringify([
    2, period.id, period.name, period.startDate, period.version,
    row.identityId, row.studentId, row.studentName, row.nisn, row.studentVersion,
    row.placementId, row.classId, row.classLabel, row.participantNumber, row.username,
    row.identityVersion, row.passwordVersion, passwordRevision,
  ])).digest("hex");
}

// Token adalah fingerprint data yang sudah dilihat admin, bukan kunci atau
// otorisasi. Pembuatan dan pemeriksaannya tetap berada di server.
export function passwordCandidate(period: IdentityPeriod, row: PasswordRow, passwordRevision: string | null): PasswordCandidate {
  return { identityId: row.identityId, studentId: row.studentId, token: candidateToken(period, row, passwordRevision) };
}

function makeDisplayRow(period: IdentityPeriod, record: PasswordPageRow): PasswordDisplayRow {
  const { passwordRevision, ...row } = record;
  return { ...row, candidate: passwordCandidate(period, row, passwordRevision) };
}

async function currentKeyStatus(client: PoolClient, key: Buffer): Promise<PasswordKeyStatus> {
  const result = await client.query<{ verifier: Buffer }>("SELECT verifier FROM participant_password_key_binding WHERE id = 1");
  if (result.rows[0]) return sameParticipantVerifier(result.rows[0].verifier, participantKeyVerifier(key)) ? "ready" : "mismatch";
  const passwords = await client.query<{ present: boolean }>("SELECT EXISTS(SELECT 1 FROM participant_passwords) AS present");
  return passwords.rows[0].present ? "inconsistent" : "ready";
}

function keyErrorStatus(error: unknown): PasswordKeyStatus {
  return error instanceof ParticipantKeyFileError && error.reason === "missing" ? "missing" : "invalid";
}

function readConfiguredKey() {
  // Diisi oleh next.config.ts pada startup. Jika root tidak diketahui, gagal
  // tertutup daripada menganggap cwd yang mungkin berbeda sebagai root proyek.
  const root = process.env.NUSACBT_INTERNAL_PROJECT_ROOT;
  if (!root || !isAbsolute(root)) throw new ParticipantKeyFileError("unreadable");
  return readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, root);
}

async function pageKeyStatus(client: PoolClient): Promise<PasswordKeyStatus> {
  let key: Buffer;
  try { key = await readConfiguredKey(); }
  catch (error) { return keyErrorStatus(error); }
  try { return await currentKeyStatus(client, key); }
  finally { key.fill(0); }
}

export async function loadPasswordPageWithClient(client: PoolClient, periodId: string | null): Promise<PasswordPageData> {
  const periods = await client.query<IdentityPeriod>(
    `SELECT id::text AS id, name, to_char(start_date, 'YYYY-MM-DD') AS "startDate",
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
     FROM exam_periods ORDER BY start_date DESC, id DESC`,
  );
  const keyStatus = await pageKeyStatus(client);
  const selected = periods.rows.find((period) => period.id === periodId) ?? null;
  if (!selected) {
    return { periods: periods.rows, selected: null, rows: [], batch: null, audit: [], keyStatus, selectionMissing: periodId !== null };
  }
  // Hash, ciphertext, dan sandi tidak dimuat untuk daftar atau HTML awal.
  // xmin mendeteksi update langsung yang tidak mengubah updated_at; tidak dikirim ke browser.
  const result = await client.query<PasswordPageRow>(
    `SELECT i.id::text AS "identityId", s.id::text AS "studentId", s.name AS "studentName", s.nisn,
      to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "studentVersion",
      p.id::text AS "placementId", p.class_id::text AS "classId",
      CASE WHEN p.id IS NULL THEN NULL ELSE c.level || ' ' || m.name END AS "classLabel",
      i.participant_number AS "participantNumber", i.username,
      to_char(i.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "identityVersion",
      to_char(pw.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "passwordVersion",
      pw.xmin::text AS "passwordRevision"
     FROM participant_identities i JOIN school_students s ON s.id = i.student_id
     LEFT JOIN student_class_placements p ON p.student_id = s.id AND p.period_id = i.period_id AND p.ended_at IS NULL
     LEFT JOIN school_classes c ON c.id = p.class_id LEFT JOIN school_majors m ON m.id = c.major_id
     LEFT JOIN participant_passwords pw ON pw.participant_identity_id = i.id
     WHERE i.period_id = $1::bigint ORDER BY lower(s.name), s.nisn, s.id`,
    [selected.id],
  );
  const rows = result.rows.map((row) => makeDisplayRow(selected, row));
  const missing = rows.filter((row) => row.placementId && !row.passwordVersion);
  const batch = missing.length ? {
    candidates: missing.slice(0, PARTICIPANT_PASSWORD_BATCH_SIZE).map((row) => row.candidate), totalMissing: missing.length,
  } : null;
  const audit = await client.query<PasswordAudit>(
    `SELECT a.id::text AS id, s.name AS "studentName", s.nisn, u.username AS "adminUsername", a.event,
      to_char(a.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS "UTC"') AS "occurredAt"
     FROM participant_password_audit a JOIN participant_identities i ON i.id = a.participant_identity_id
     JOIN school_students s ON s.id = i.student_id JOIN admin_users u ON u.id = a.admin_id
     WHERE i.period_id = $1::bigint ORDER BY a.id DESC LIMIT 20`,
    [selected.id],
  );
  return { periods: periods.rows, selected, rows, batch, audit: audit.rows, keyStatus, selectionMissing: false };
}

export async function loadPasswordPage(periodId: string | null): Promise<PasswordPageData> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const data = await loadPasswordPageWithClient(client, periodId);
    await client.query("COMMIT");
    return data;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

function keyProblem(status: PasswordKeyStatus): PasswordProblem {
  if (status === "missing") return new PasswordProblem("Kunci sandi peserta belum dikonfigurasi. Minta pengelola server menyiapkannya sesuai petunjuk.");
  if (status === "mismatch") return new PasswordProblem("Kunci tidak cocok dengan database. Pulihkan kunci yang benar; tidak ada sandi yang diubah atau ditampilkan.");
  if (status === "inconsistent") return new PasswordProblem("Pengikat kunci database tidak tersedia. Pulihkan database dan kunci dari cadangan yang sesuai; tidak ada sandi yang diubah atau ditampilkan.");
  return new PasswordProblem("File kunci tidak dapat dibaca atau tidak valid. Periksa konfigurasi dan izin file di server.");
}

async function loadKey(): Promise<Buffer> {
  try { return await readConfiguredKey(); }
  catch (error) { throw keyProblem(keyErrorStatus(error)); }
}

async function preflightKey(key: Buffer) {
  const client = await getPostgresPool().connect();
  try {
    const status = await currentKeyStatus(client, key);
    if (status !== "ready") throw keyProblem(status);
  } finally { client.release(); }
}

// Kunci pertama hanya diikat untuk database tanpa sandi. Baris dikunci bersama
// selama transaksi; konfigurasi kunci yang berbeda tidak dapat mencampur ciphertext.
async function lockKeyBinding(client: PoolClient, key: Buffer, allowInitialize: boolean) {
  let result = await client.query<{ verifier: Buffer }>("SELECT verifier FROM participant_password_key_binding WHERE id = 1 FOR SHARE");
  if (!result.rowCount && allowInitialize) {
    await client.query(
      `INSERT INTO participant_password_key_binding (id, verifier)
       SELECT 1, $1::bytea WHERE NOT EXISTS (SELECT 1 FROM participant_passwords)
       ON CONFLICT (id) DO NOTHING`,
      [participantKeyVerifier(key)],
    );
    result = await client.query<{ verifier: Buffer }>("SELECT verifier FROM participant_password_key_binding WHERE id = 1 FOR SHARE");
  }
  if (!result.rowCount) throw keyProblem("inconsistent");
  if (!sameParticipantVerifier(result.rows[0].verifier, participantKeyVerifier(key))) throw keyProblem("mismatch");
}

function parseCandidates(formData: FormData, limit: number = PARTICIPANT_PASSWORD_BATCH_SIZE): { periodId: string; candidates: PasswordCandidate[] } {
  const periodId = validDataId(formData.get("periodId"));
  const input = formData.get("candidates");
  if (!periodId || typeof input !== "string" || input.length > limit * 200 + 1_000) throw new PasswordProblem("Permintaan tidak valid. Muat ulang halaman.");
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { throw new PasswordProblem("Daftar peserta tidak valid. Muat ulang halaman."); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > limit || parsed.some((item) =>
    !item || typeof item !== "object" || !validDataId(item.identityId) || !validDataId(item.studentId) ||
    typeof item.token !== "string" || !/^[0-9a-f]{64}$/.test(item.token))) {
    throw new PasswordProblem("Daftar peserta tidak valid. Muat ulang halaman.");
  }
  const candidates: PasswordCandidate[] = parsed.map((item) => ({ identityId: item.identityId, studentId: item.studentId, token: item.token }));
  if (new Set(candidates.map((item) => item.identityId)).size !== candidates.length ||
      new Set(candidates.map((item) => item.studentId)).size !== candidates.length) {
    throw new PasswordProblem("Daftar peserta duplikat. Muat ulang halaman.");
  }
  candidates.sort((a, b) => BigInt(a.studentId) < BigInt(b.studentId) ? -1 : BigInt(a.studentId) > BigInt(b.studentId) ? 1 : 0);
  return { periodId, candidates };
}

async function lockedRows(client: PoolClient, periodId: string, candidates: PasswordCandidate[]) {
  const studentIds = candidates.map((item) => item.studentId);
  const identityIds = candidates.map((item) => item.identityId);
  // Sama seperti layanan identitas: siswa, periode, penempatan, identitas, sandi.
  const students = await client.query<Student>(
    `SELECT id::text AS id, name, nisn, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
     FROM school_students WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`, [studentIds],
  );
  const periods = await client.query<IdentityPeriod>(
    `SELECT id::text AS id, name, to_char(start_date, 'YYYY-MM-DD') AS "startDate",
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
     FROM exam_periods WHERE id = $1::bigint FOR SHARE`, [periodId],
  );
  const placements = await client.query<Placement>(
    `SELECT p.id::text AS id, p.student_id::text AS "studentId", p.class_id::text AS "classId", c.level || ' ' || m.name AS "classLabel"
     FROM student_class_placements p JOIN school_classes c ON c.id = p.class_id JOIN school_majors m ON m.id = c.major_id
     WHERE p.period_id = $1::bigint AND p.student_id = ANY($2::bigint[]) AND p.ended_at IS NULL
     ORDER BY p.student_id FOR UPDATE OF p FOR SHARE OF c, m`, [periodId, studentIds],
  );
  const identities = await client.query<Identity>(
    `SELECT id::text AS id, student_id::text AS "studentId", participant_number AS "participantNumber", username,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
     FROM participant_identities WHERE period_id = $1::bigint AND id = ANY($2::bigint[])
     ORDER BY student_id FOR UPDATE`, [periodId, identityIds],
  );
  // Metadata cukup untuk mendeteksi reset/perubahan. Ciphertext hanya dimuat
  // setelah admin benar-benar meminta pengungkapan sandi.
  const passwords = await client.query<PasswordMetadata>(
    `SELECT participant_identity_id::text AS "identityId", xmin::text AS revision,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
     FROM participant_passwords WHERE participant_identity_id = ANY($1::bigint[]) ORDER BY participant_identity_id FOR UPDATE`, [identityIds],
  );
  if (students.rowCount !== candidates.length || periods.rowCount !== 1 || placements.rowCount !== candidates.length || identities.rowCount !== candidates.length) {
    throw new PasswordProblem("Data atau kelas aktif berubah. Tidak ada perubahan; muat ulang halaman.");
  }
  const period = periods.rows[0];
  const studentById = new Map(students.rows.map((row) => [row.id, row]));
  const placementByStudent = new Map(placements.rows.map((row) => [row.studentId, row]));
  const identityById = new Map(identities.rows.map((row) => [row.id, row]));
  const passwordById = new Map(passwords.rows.map((row) => [row.identityId, row]));
  const rows = candidates.map((candidate) => {
    const student = studentById.get(candidate.studentId);
    const placement = placementByStudent.get(candidate.studentId);
    const identity = identityById.get(candidate.identityId);
    const password = passwordById.get(candidate.identityId) ?? null;
    if (!student || !placement || !identity || identity.studentId !== student.id) throw new PasswordProblem("Data peserta berubah. Tidak ada perubahan; muat ulang halaman.");
    const row: PasswordRow = {
      identityId: identity.id, studentId: student.id, studentName: student.name, nisn: student.nisn, studentVersion: student.version,
      placementId: placement.id, classId: placement.classId, classLabel: placement.classLabel,
      participantNumber: identity.participantNumber, username: identity.username, identityVersion: identity.version,
      passwordVersion: password?.version ?? null,
    };
    if (candidateToken(period, row, password?.revision ?? null) !== candidate.token) throw new PasswordProblem("Data atau sandi berubah di sesi lain. Tidak ada perubahan; muat ulang halaman.");
    return { row, password };
  });
  return rows;
}

// Semua baris sandi sudah dikunci oleh lockedRows pada transaksi yang sama.
async function lockedCiphertexts(client: PoolClient, identityIds: string[]) {
  const result = await client.query<PasswordCiphertext>(
    `SELECT participant_identity_id::text AS "identityId", nonce, ciphertext, authentication_tag AS "authenticationTag"
     FROM participant_passwords WHERE participant_identity_id = ANY($1::bigint[]) ORDER BY participant_identity_id`, [identityIds],
  );
  if (result.rowCount !== identityIds.length) throw new PasswordProblem("Sandi berubah. Muat ulang halaman.");
  return new Map(result.rows.map((row) => [row.identityId, row]));
}

export class PasswordSessionExpired extends PasswordProblem {}

async function requireActiveSession(client: PoolClient, expectedId?: string) {
  const admin = await lockActiveAdminSession(client);
  if (!admin || (expectedId && admin.id !== expectedId)) throw new PasswordSessionExpired("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
  return admin;
}

function knownDatabaseProblem(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error && ["23505", "23503", "23001", "40001", "40P01"].includes(String(error.code))) {
    return new PasswordProblem("Data berubah saat penyimpanan. Tidak ada perubahan; muat ulang halaman.");
  }
  return error;
}

export async function saveParticipantPasswords(formData: FormData): Promise<string> {
  const { periodId, candidates } = parseCandidates(formData);
  const operation = formData.get("operation");
  const mode = formData.get("mode");
  if ((operation !== "create" && operation !== "reset") || (mode !== "manual" && mode !== "auto") ||
      (operation === "reset" && candidates.length !== 1) || (mode === "manual" && candidates.length !== 1)) {
    throw new PasswordProblem("Permintaan tidak valid. Muat ulang halaman.");
  }
  let manualPassword: string | null = null;
  if (mode === "manual") {
    const checked = validateParticipantPassword(formData.get("password"));
    if (!checked.ok) throw new PasswordProblem(checked.error);
    if (formData.get("passwordConfirmation") !== checked.value) throw new PasswordProblem("Konfirmasi sandi tidak sama.");
    manualPassword = checked.value;
  }
  const key = await loadKey();
  try {
    await preflightKey(key);
    // Scrypt sengaja berurutan dan dibatasi per batch; tidak menahan lock selama hashing.
    const prepared: PreparedPassword[] = [];
    for (const candidate of candidates) {
      const password = manualPassword ?? generateParticipantPassword();
      const hash = await hashParticipantPassword(password);
      const encrypted = encryptParticipantPassword(password, key, { identityId: candidate.identityId, periodId });
      prepared.push({ identityId: candidate.identityId, hash, ...encrypted });
    }
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const admin = await requireActiveSession(client);
      await lockKeyBinding(client, key, operation === "create");
      const rows = await lockedRows(client, periodId, candidates);
      if (rows.some(({ password }) => operation === "create" ? password !== null : password === null)) {
        throw new PasswordProblem("Status sandi berubah. Tidak ada perubahan; muat ulang halaman.");
      }
      const event = `${operation}_${mode}`;
      for (const entry of prepared) {
        if (operation === "create") {
          await client.query(
            `INSERT INTO participant_passwords (participant_identity_id, password_hash, nonce, ciphertext, authentication_tag)
             VALUES ($1::bigint, $2, $3, $4, $5)`,
            [entry.identityId, entry.hash, entry.nonce, entry.ciphertext, entry.authenticationTag],
          );
        } else {
          await client.query(
            `UPDATE participant_passwords SET password_hash = $2, nonce = $3, ciphertext = $4, authentication_tag = $5,
              updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
             WHERE participant_identity_id = $1::bigint`,
            [entry.identityId, entry.hash, entry.nonce, entry.ciphertext, entry.authenticationTag],
          );
        }
        await client.query(
          "INSERT INTO participant_password_audit (participant_identity_id, admin_id, event) VALUES ($1::bigint, $2::bigint, $3)",
          [entry.identityId, admin.id, event],
        );
      }
      await requireActiveSession(client, admin.id);
      await client.query("COMMIT");
      return operation === "create" ? `${prepared.length} sandi peserta dibuat. Sandi yang sudah ada tidak diubah.` : "Sandi peserta berhasil di-reset.";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw knownDatabaseProblem(error);
    } finally { client.release(); }
  } finally { key.fill(0); }
}

export async function revealParticipantPassword(formData: FormData): Promise<string> {
  const { periodId, candidates } = parseCandidates(formData);
  if (candidates.length !== 1) throw new PasswordProblem("Permintaan tidak valid. Muat ulang halaman.");
  const key = await loadKey();
  try {
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const admin = await requireActiveSession(client);
      await lockKeyBinding(client, key, false);
      const [{ row, password }] = await lockedRows(client, periodId, candidates);
      if (!password) throw new PasswordProblem("Sandi belum tersedia. Muat ulang halaman.");
      const ciphertext = (await lockedCiphertexts(client, [row.identityId])).get(row.identityId);
      if (!ciphertext) throw new PasswordProblem("Sandi berubah. Muat ulang halaman.");
      let plaintext: string;
      try { plaintext = decryptParticipantPassword(ciphertext, key, { identityId: row.identityId, periodId }); }
      catch { throw new PasswordProblem("Sandi tidak dapat ditampilkan. Periksa kunci dan integritas data; tidak ada sandi yang diubah."); }
      await client.query(
        "INSERT INTO participant_password_audit (participant_identity_id, admin_id, event) VALUES ($1::bigint, $2::bigint, 'reveal')",
        [row.identityId, admin.id],
      );
      await requireActiveSession(client, admin.id);
      await client.query("COMMIT");
      return plaintext; // Tidak dikirim jika audit atau commit gagal.
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw knownDatabaseProblem(error);
    } finally { client.release(); }
  } finally { key.fill(0); }
}

/**
 * Siapkan satu batch kartu, atau periksa ulang sebelum dialog cetak. Tanpa
 * includePassword fungsi ini tidak membaca file kunci maupun ciphertext. Dengan
 * sandi, SEMUA identitas dan audit commit sebelum plaintext dikembalikan.
 */
export async function prepareParticipantCards(formData: FormData, filters: CardFilters, includePassword: boolean): Promise<PreparedCards> {
  const { periodId, candidates } = parseCandidates(formData, PARTICIPANT_CARD_BATCH_SIZE);
  if (periodId !== filters.periodId) throw new PasswordProblem("Periode kartu tidak valid. Muat ulang halaman.");
  const key = includePassword ? await loadKey() : null;
  try {
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const admin = await requireActiveSession(client);
      if (key) await lockKeyBinding(client, key, false);
      // Penarikan/penyuntingan rilis di aplikasi menggunakan pagar periode
      // ini sebelum mengunci siswa. Tidak mengunci tes setelah siswa agar
      // urutan tetap kompatibel dengan mulai tes dan mutasi jadwal.
      if ((filters.testId || filters.kind) && !await lockSchedulePeriod(client, periodId)) {
        throw new PasswordProblem("Periode sudah dihapus. Muat ulang halaman.");
      }
      const rows = await lockedRows(client, periodId, candidates);
      const eligible = await client.query<{ studentId: string }>(
        `SELECT s.id::text AS "studentId" FROM student_class_placements p
         JOIN school_students s ON s.id=p.student_id
         JOIN participant_identities i ON i.student_id=s.id AND i.period_id=p.period_id
         WHERE ${cardFilterCondition} AND s.id=ANY($6::bigint[])`,
        [...cardFilterValues(filters), candidates.map((candidate) => candidate.studentId)],
      );
      if (eligible.rowCount !== candidates.length) {
        throw new PasswordProblem("Peserta tidak lagi cocok dengan kelas, pencarian, tes, atau pelaksanaan dirilis yang dipilih. Muat ulang dan pilih kembali.");
      }
      if (includePassword && rows.some(({ password }) => !password)) {
        throw new PasswordProblem("Ada peserta terpilih yang belum memiliki sandi. Buat sandi terlebih dahulu atau siapkan kartu tanpa sandi; tidak ada sandi yang ditampilkan.");
      }
      const period = await client.query<{ name: string }>("SELECT name FROM exam_periods WHERE id=$1::bigint", [periodId]);
      if (period.rowCount !== 1) throw new PasswordProblem("Periode berubah. Muat ulang halaman.");
      const secrets = new Map<string, string>();
      if (key) {
        const encrypted = await lockedCiphertexts(client, rows.map(({ row }) => row.identityId));
        try {
          for (const { row } of rows) {
            const ciphertext = encrypted.get(row.identityId);
            if (!ciphertext) throw new Error("Sandi tidak ditemukan.");
            secrets.set(row.identityId, decryptParticipantPassword(ciphertext, key, { identityId: row.identityId, periodId }));
          }
        } catch {
          throw new PasswordProblem("Sandi tidak dapat ditampilkan. Periksa kunci dan integritas data; tidak ada sandi yang ditampilkan atau diubah.");
        }
        await client.query(
          `INSERT INTO participant_password_audit (participant_identity_id,admin_id,event)
           SELECT id,$2::bigint,'reveal' FROM unnest($1::bigint[]) AS x(id)`,
          [rows.map(({ row }) => row.identityId), admin.id],
        );
      }
      const result: PreparedCards = {
        periodName: period.rows[0].name,
        preparedAt: new Date().toISOString(),
        cards: rows.map(({ row }) => ({
          studentName: row.studentName, nisn: row.nisn, classLabel: row.classLabel!,
          participantNumber: row.participantNumber, username: row.username, password: key ? secrets.get(row.identityId)! : null,
        })).sort((a, b) => a.studentName.localeCompare(b.studentName, "id") || a.nisn.localeCompare(b.nisn)),
      };
      await requireActiveSession(client, admin.id);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw knownDatabaseProblem(error);
    } finally { client.release(); }
  } finally { key?.fill(0); }
}

export function passwordErrorMessage(error: unknown): string {
  if (error instanceof PasswordProblem) return error.message;
  return "Hasil tindakan belum dapat dipastikan. Periksa sesi dan daftar, lalu muat ulang halaman sebelum mencoba lagi.";
}
