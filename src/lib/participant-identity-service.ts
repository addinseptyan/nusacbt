import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import { validDataId } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";
import {
  MAX_IDENTITY_BATCH,
  planAutomaticIdentities,
  validateParticipantNumber,
  validateParticipantUsername,
} from "@/lib/participant-identity-validation.mjs";
import type { IdentityPageData, IdentityPeriod, ParticipantIdentityRow } from "@/lib/participant-identity-types";

type Student = { id: string; name: string; nisn: string; version: string };
type ActivePlacement = { id: string; studentId: string; classId: string; classLabel: string };
type IdentityRecord = { id: string; participantNumber: string; username: string; version: string };
type Candidate = {
  studentId: string;
  studentName: string;
  nisn: string;
  studentVersion: string;
  placementId: string;
  classId: string;
  classLabel: string;
};

class IdentityProblem extends Error {}

function versionIsValid(value: FormDataEntryValue | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value);
}

function sortedCandidates(candidates: Candidate[]) {
  return [...candidates].sort((a, b) => {
    const left = BigInt(a.studentId);
    const right = BigInt(b.studentId);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function batchToken(period: IdentityPeriod, candidates: Candidate[]) {
  // Fingerprint untuk mendeteksi data usang; autentikasi tetap diperiksa secara terpisah.
  return createHash("sha256").update(JSON.stringify({ version: 1, period, candidates: sortedCandidates(candidates) })).digest("hex");
}

function rowCandidate(row: ParticipantIdentityRow): Candidate {
  if (!row.placementId || !row.classId || row.classLabel === null) throw new Error("Data calon peserta tidak lengkap.");
  return {
    studentId: row.studentId,
    studentName: row.studentName,
    nisn: row.nisn,
    studentVersion: row.studentVersion,
    placementId: row.placementId,
    classId: row.classId,
    classLabel: row.classLabel,
  };
}

async function getPeriod(client: PoolClient, id: string, lock: boolean): Promise<IdentityPeriod> {
  const result = await client.query<IdentityPeriod>(
    `SELECT id::text AS id, name, to_char(start_date, 'YYYY-MM-DD') AS "startDate",
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
     FROM exam_periods WHERE id = $1::bigint ${lock ? "FOR SHARE" : ""}`,
    [id],
  );
  if (!result.rowCount) throw new IdentityProblem("Periode tidak ditemukan atau sudah dihapus. Muat ulang halaman.");
  return result.rows[0];
}

export async function loadIdentityPage(periodId: string | null): Promise<IdentityPageData> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const periods = await client.query<IdentityPeriod>(
      `SELECT id::text AS id, name, to_char(start_date, 'YYYY-MM-DD') AS "startDate",
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
       FROM exam_periods ORDER BY start_date DESC, id DESC`,
    );
    const selected = periods.rows.find((period) => period.id === periodId) ?? null;
    if (!selected) {
      await client.query("COMMIT");
      return { periods: periods.rows, selected: null, rows: [], batch: null, selectionMissing: periodId !== null };
    }
    const result = await client.query<ParticipantIdentityRow>(
      `SELECT s.id::text AS "studentId", s.name AS "studentName", s.nisn,
        to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "studentVersion",
        p.id::text AS "placementId", p.class_id::text AS "classId",
        CASE WHEN p.id IS NULL THEN NULL ELSE c.level || ' ' || m.name END AS "classLabel",
        i.id::text AS "identityId", i.participant_number AS "participantNumber", i.username,
        to_char(i.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "identityVersion"
       FROM school_students s
       LEFT JOIN student_class_placements p ON p.student_id = s.id AND p.period_id = $1::bigint AND p.ended_at IS NULL
       LEFT JOIN school_classes c ON c.id = p.class_id
       LEFT JOIN school_majors m ON m.id = c.major_id
       LEFT JOIN participant_identities i ON i.student_id = s.id AND i.period_id = $1::bigint
       WHERE p.id IS NOT NULL OR i.id IS NOT NULL
       ORDER BY lower(s.name), s.nisn, s.id`,
      [selected.id],
    );
    const missing = result.rows.filter((row) => row.placementId && !row.identityId);
    const candidates = missing.slice(0, MAX_IDENTITY_BATCH).map(rowCandidate);
    const batch = candidates.length ? {
      studentIds: candidates.map((candidate) => candidate.studentId),
      token: batchToken(selected, candidates),
      totalMissing: missing.length,
    } : null;
    await client.query("COMMIT");
    return { periods: periods.rows, selected, rows: result.rows, batch, selectionMissing: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function databaseProblem(error: unknown, bulk: boolean): IdentityProblem | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = String(error.code);
  const constraint = "constraint" in error ? String(error.constraint) : "";
  if (code === "23505") {
    if (!bulk && constraint === "participant_identities_number_period_ci_idx") {
      return new IdentityProblem("Nomor peserta sudah digunakan dalam periode ini, tanpa membedakan huruf besar dan kecil.");
    }
    if (!bulk && constraint === "participant_identities_username_period_ci_idx") {
      return new IdentityProblem("Username sudah digunakan dalam periode ini, tanpa membedakan huruf besar dan kecil.");
    }
    return new IdentityProblem("Identitas berubah atau berbenturan saat penyimpanan. Tidak ada perubahan yang disimpan; muat ulang dan coba lagi.");
  }
  if (["23503", "23001", "40001", "40P01"].includes(code)) {
    return new IdentityProblem("Data berubah saat penyimpanan. Tidak ada perubahan yang disimpan; muat ulang dan coba lagi.");
  }
  return null;
}

export async function saveParticipantIdentity(formData: FormData): Promise<string> {
  const studentId = validDataId(formData.get("studentId"));
  const periodId = validDataId(formData.get("periodId"));
  const placementId = validDataId(formData.get("placementId"));
  const classId = validDataId(formData.get("classId"));
  const classLabel = formData.get("classLabel");
  const studentVersion = formData.get("studentVersion");
  const studentName = formData.get("studentName");
  const nisn = formData.get("nisn");
  const periodVersion = formData.get("periodVersion");
  const periodName = formData.get("periodName");
  const periodStartDate = formData.get("periodStartDate");
  const rawIdentityId = formData.get("identityId");
  const rawIdentityVersion = formData.get("identityVersion");
  const expectedNumber = formData.get("expectedParticipantNumber");
  const expectedUsername = formData.get("expectedUsername");
  const identityId = rawIdentityId === "" ? null : validDataId(rawIdentityId);
  if (!studentId || !periodId || !placementId || !classId || typeof classLabel !== "string" || classLabel.length > 150 ||
      !versionIsValid(studentVersion) || typeof studentName !== "string" || studentName.length > 200 ||
      typeof nisn !== "string" || !/^\d{10}$/.test(nisn) || !versionIsValid(periodVersion) ||
      typeof periodName !== "string" || periodName.length > 200 || typeof periodStartDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(periodStartDate) ||
      typeof expectedNumber !== "string" || expectedNumber.length > 64 || typeof expectedUsername !== "string" || expectedUsername.length > 64 ||
      (rawIdentityId !== "" && !identityId) || (identityId && (!versionIsValid(rawIdentityVersion) || !expectedNumber || !expectedUsername)) ||
      (!identityId && (rawIdentityVersion !== "" || expectedNumber !== "" || expectedUsername !== ""))) {
    throw new IdentityProblem("Data formulir tidak valid atau sudah usang. Muat ulang halaman.");
  }
  const number = validateParticipantNumber(formData.get("participantNumber"));
  if (!number.ok) throw new IdentityProblem(number.error);
  const username = validateParticipantUsername(formData.get("username"));
  if (!username.ok) throw new IdentityProblem(username.error);

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    // Urutan sama dengan penempatan manual: siswa, periode, penempatan, identitas.
    const student = await client.query<Student>(
      `SELECT id::text AS id, name, nisn,
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
       FROM school_students WHERE id = $1::bigint FOR UPDATE`, [studentId],
    );
    if (!student.rowCount || student.rows[0].version !== studentVersion ||
        student.rows[0].name !== studentName || student.rows[0].nisn !== nisn) {
      throw new IdentityProblem("Data siswa berubah atau sudah dihapus. Muat ulang halaman sebelum menyimpan.");
    }
    const period = await getPeriod(client, periodId, true);
    if (period.version !== periodVersion || period.name !== periodName || period.startDate !== periodStartDate) {
      throw new IdentityProblem("Periode berubah. Muat ulang halaman sebelum menyimpan.");
    }
    const placement = await client.query<{ id: string; classId: string; classLabel: string }>(
      `SELECT p.id::text AS id, p.class_id::text AS "classId", c.level || ' ' || m.name AS "classLabel"
       FROM student_class_placements p JOIN school_classes c ON c.id = p.class_id JOIN school_majors m ON m.id = c.major_id
       WHERE p.student_id = $1::bigint AND p.period_id = $2::bigint AND p.ended_at IS NULL
       FOR UPDATE OF p FOR SHARE OF c, m`,
      [studentId, periodId],
    );
    if (!placement.rowCount || placement.rows[0].id !== placementId ||
        placement.rows[0].classId !== classId || placement.rows[0].classLabel !== classLabel) {
      throw new IdentityProblem("Kelas aktif siswa berubah atau berakhir. Muat ulang halaman sebelum menyimpan.");
    }
    const existing = await client.query<IdentityRecord>(
      `SELECT id::text AS id, participant_number AS "participantNumber", username,
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
       FROM participant_identities WHERE student_id = $1::bigint AND period_id = $2::bigint FOR UPDATE`,
      [studentId, periodId],
    );
    const current = existing.rows[0];
    if ((!identityId && current) || (identityId && (!current || current.id !== identityId || current.version !== rawIdentityVersion ||
        current.participantNumber !== expectedNumber || current.username !== expectedUsername))) {
      throw new IdentityProblem("Identitas peserta berubah di sesi lain. Muat ulang halaman sebelum menyimpan.");
    }
    let message;
    if (current && current.participantNumber === number.value && current.username === username.value) {
      message = "Identitas peserta sudah sesuai.";
    } else if (current) {
      await client.query(
        `UPDATE participant_identities SET participant_number = $1, username = $2,
          updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
         WHERE id = $3::bigint`,
        [number.value, username.value, current.id],
      );
      message = "Identitas peserta berhasil diubah.";
    } else {
      await client.query(
        "INSERT INTO participant_identities (student_id, period_id, participant_number, username) VALUES ($1::bigint, $2::bigint, $3, $4)",
        [studentId, periodId, number.value, username.value],
      );
      message = "Identitas peserta berhasil ditambahkan.";
    }
    await client.query("COMMIT");
    return message;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw databaseProblem(error, false) ?? error;
  } finally {
    client.release();
  }
}

function parseBatchIds(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || value.length > 24_000) throw new IdentityProblem("Daftar peserta tidak valid. Muat ulang halaman.");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new IdentityProblem("Daftar peserta tidak valid. Muat ulang halaman."); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_IDENTITY_BATCH ||
      parsed.some((id) => !validDataId(id)) || new Set(parsed).size !== parsed.length) {
    throw new IdentityProblem("Daftar peserta tidak valid. Muat ulang halaman.");
  }
  return parsed as string[];
}

export async function generateParticipantIdentities(formData: FormData): Promise<string> {
  const periodId = validDataId(formData.get("periodId"));
  const expectedToken = formData.get("batchToken");
  if (!periodId || typeof expectedToken !== "string" || !/^[0-9a-f]{64}$/.test(expectedToken)) {
    throw new IdentityProblem("Rencana pembuatan tidak valid. Muat ulang halaman.");
  }
  const ids = parseBatchIds(formData.get("studentIds"));
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    // Kunci dengan urutan ID agar tidak saling menimpa penempatan atau identitas manual.
    const students = await client.query<Student>(
      `SELECT id::text AS id, name, nisn,
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
       FROM school_students WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`, [ids],
    );
    if (students.rowCount !== ids.length) throw new IdentityProblem("Daftar siswa berubah. Tidak ada data yang disimpan; muat ulang halaman.");
    const period = await getPeriod(client, periodId, true);
    const placements = await client.query<ActivePlacement>(
      `SELECT p.id::text AS id, p.student_id::text AS "studentId", p.class_id::text AS "classId",
        c.level || ' ' || m.name AS "classLabel"
       FROM student_class_placements p JOIN school_classes c ON c.id = p.class_id JOIN school_majors m ON m.id = c.major_id
       WHERE p.period_id = $1::bigint AND p.student_id = ANY($2::bigint[]) AND p.ended_at IS NULL
       ORDER BY p.student_id FOR UPDATE OF p FOR SHARE OF c, m`,
      [periodId, ids],
    );
    const already = await client.query<{ studentId: string }>(
      `SELECT student_id::text AS "studentId" FROM participant_identities
       WHERE period_id = $1::bigint AND student_id = ANY($2::bigint[]) FOR UPDATE`, [periodId, ids],
    );
    if (placements.rowCount !== ids.length || already.rowCount !== 0) {
      throw new IdentityProblem("Penempatan atau identitas berubah sejak daftar dimuat. Tidak ada data yang disimpan; muat ulang halaman.");
    }
    const placementByStudent = new Map(placements.rows.map((item) => [item.studentId, item]));
    const candidates = students.rows.map((student): Candidate => {
      const placement = placementByStudent.get(student.id);
      if (!placement) throw new IdentityProblem("Penempatan siswa berubah. Tidak ada data yang disimpan; muat ulang halaman.");
      return {
        studentId: student.id, studentName: student.name, nisn: student.nisn, studentVersion: student.version,
        placementId: placement.id, classId: placement.classId, classLabel: placement.classLabel,
      };
    });
    if (batchToken(period, candidates) !== expectedToken) {
      throw new IdentityProblem("Data berubah sejak daftar dimuat. Tidak ada data yang disimpan; muat ulang halaman.");
    }
    const used = await client.query<{ participantNumber: string; username: string }>(
      `SELECT participant_number AS "participantNumber", username FROM participant_identities WHERE period_id = $1::bigint`,
      [periodId],
    );
    const plan = planAutomaticIdentities({
      count: candidates.length,
      prefix: formData.get("prefix"),
      numberPattern: formData.get("numberPattern"),
      usernamePattern: formData.get("usernamePattern"),
      startDate: period.startDate,
      usedNumbers: used.rows.map((row) => row.participantNumber),
      usedUsernames: used.rows.map((row) => row.username),
    });
    if (!plan.ok) throw new IdentityProblem(plan.error);
    const inserted = await client.query(
      `INSERT INTO participant_identities (period_id, student_id, participant_number, username)
       SELECT $1::bigint, input.student_id::bigint, input.participant_number, input.username
       FROM unnest($2::text[], $3::text[], $4::text[]) AS input(student_id, participant_number, username)`,
      [periodId, candidates.map((row) => row.studentId), plan.values.map((row) => row.number), plan.values.map((row) => row.username)],
    );
    if (inserted.rowCount !== candidates.length) throw new Error("Jumlah identitas yang disimpan tidak sesuai.");
    await client.query("COMMIT");
    return `${candidates.length} identitas baru dibuat. Identitas yang sudah ada tidak diubah.`;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw databaseProblem(error, true) ?? error;
  } finally {
    client.release();
  }
}

export function identityErrorMessage(error: unknown): string {
  if (error instanceof IdentityProblem) return error.message;
  return "Hasil penyimpanan belum dapat dipastikan. Periksa daftar identitas dan koneksi, lalu muat ulang halaman sebelum mencoba lagi.";
}
