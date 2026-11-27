"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { lockActiveAdminSession, PERMISSION_DENIED_MESSAGE, requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { AcademicYearProblem, lockAcademicMutation, syncYearPlacements } from "@/lib/academic-year-service";
import { validDataId } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";
import { validateStudentInput } from "@/lib/student-validation.mjs";
import { validTopicRevision } from "@/lib/topic-validation.mjs";

type Result = { ok: true; message: string } | { ok: false; error: string };

function validStudentVersion(value: FormDataEntryValue | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value);
}

const REVALIDATE_STUDENT_PATHS = [
  "/data-peserta/siswa",
  "/data-peserta/tahun-ajaran",
  "/data-peserta/periode",
  "/data-peserta/akun",
  "/data-peserta/kartu",
];

export async function saveYearStudent(form: FormData): Promise<Result> {
  const { allowed } = await requireAdminAccess("students.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const mode = form.get("mode"); const yearId = validDataId(form.get("yearId")); const classId = validDataId(form.get("classId"));
  const studentId = mode === "new" ? null : validDataId(form.get("studentId"));
  const status = form.get("status");
  const expected = mode === "edit" ? validDataId(form.get("enrollmentId")) : null;
  const revision = mode === "edit" ? validTopicRevision(form.get("revision")) : null;
  if (!yearId || !classId || !["new", "existing", "edit"].includes(String(mode)) ||
      (mode !== "new" && !studentId) || (mode === "edit" && (!expected || !revision)) ||
      !["active", "graduated", "left"].includes(String(status)) || (mode !== "edit" && status !== "active")) {
    return { ok: false, error: "Data tahun, siswa, kelas, atau status tidak valid." };
  }
  const parsed = mode === "new" ? validateStudentInput({ name: form.get("name"), nisn: form.get("nisn") }) : null;
  if (parsed && !parsed.ok) return parsed;
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect(); await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client); if (!admin) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    if (!adminHasPermission(admin, "students.manage")) throw new AcademicYearProblem(PERMISSION_DENIED_MESSAGE);
    await lockAcademicMutation(client);
    const year = await client.query("SELECT id FROM academic_years WHERE id=$1::bigint FOR UPDATE", [yearId]);
    if (!year.rowCount) throw new AcademicYearProblem("Tahun ajaran tidak ditemukan.");
    const klass = await client.query<{ label: string }>(
      `SELECT c.level || ' ' || m.name AS label FROM school_classes c JOIN school_majors m ON m.id=c.major_id
       WHERE c.id=$1::bigint FOR SHARE OF c,m`, [classId],
    );
    if (!klass.rowCount) throw new AcademicYearProblem("Kelas tidak ditemukan.");
    let actualStudent = studentId;
    if (mode === "new" && parsed?.ok) {
      const created = await client.query<{ id: string }>("INSERT INTO school_students(name,nisn) VALUES($1,$2) RETURNING id::text AS id", [parsed.value.name, parsed.value.nisn]);
      actualStudent = created.rows[0].id;
    } else {
      const found = await client.query("SELECT id FROM school_students WHERE id=$1::bigint FOR UPDATE", [studentId]);
      if (!found.rowCount) throw new AcademicYearProblem("Siswa tidak ditemukan.");
    }
    const existing = await client.query<{ id: string; revision: string }>(
      'SELECT id::text AS id,xmin::text AS revision FROM academic_year_enrollments WHERE academic_year_id=$1::bigint AND student_id=$2::bigint FOR UPDATE', [yearId, actualStudent],
    );
    if (mode === "edit") {
      if (!existing.rowCount || existing.rows[0].id !== expected || existing.rows[0].revision !== revision) throw new AcademicYearProblem("Data siswa pada tahun ini berubah. Muat ulang dan periksa kembali.");
      await client.query(`UPDATE academic_year_enrollments SET class_id=$1::bigint,class_name_snapshot=$2,status=$3,transition='manual',updated_at=clock_timestamp() WHERE id=$4::bigint`, [classId, klass.rows[0].label, status, expected]);
    } else {
      if (existing.rowCount) throw new AcademicYearProblem("Siswa sudah tercatat pada tahun ajaran tersebut.");
      await client.query(`INSERT INTO academic_year_enrollments(academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES($1::bigint,$2::bigint,$3::bigint,$4,'active')`, [yearId, actualStudent, classId, klass.rows[0].label]);
    }
    await syncYearPlacements(client, yearId, [actualStudent!]);
    const active = await lockActiveAdminSession(client); if (!active || active.id !== admin.id) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    await client.query("COMMIT");
    for (const path of REVALIDATE_STUDENT_PATHS) revalidatePath(path);
    return { ok: true, message: mode === "edit" ? "Data siswa tahun ajaran diperbarui; riwayat penempatan tetap disimpan." : "Siswa ditambahkan ke tahun ajaran." };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof AcademicYearProblem) return { ok: false, error: error.message };
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return { ok: false, error: "NISN sudah digunakan atau siswa sudah ada pada tahun ini. Pilih siswa yang sudah ada." };
    return { ok: false, error: "Hasil penyimpanan belum dapat dipastikan. Muat ulang roster sebelum mencoba lagi." };
  } finally { client?.release(); }
}

export async function saveManagedYearStudent(form: FormData): Promise<Result> {
  const { allowed } = await requireAdminAccess("students.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };

  const yearId = validDataId(form.get("yearId"));
  const studentId = validDataId(form.get("studentId"));
  const enrollmentId = validDataId(form.get("enrollmentId"));
  const classId = validDataId(form.get("classId"));
  const revision = validTopicRevision(form.get("revision"));
  const studentVersion = form.get("studentVersion");
  const status = form.get("status");

  if (
    !yearId ||
    !studentId ||
    !enrollmentId ||
    !classId ||
    !revision ||
    !validStudentVersion(studentVersion) ||
    !["active", "graduated", "left"].includes(String(status))
  ) {
    return { ok: false, error: "Data tahun, siswa, kelas, status, atau versi tidak valid." };
  }

  const parsed = validateStudentInput({ name: form.get("name"), nisn: form.get("nisn") });
  if (!parsed.ok) return parsed;

  let client: PoolClient | undefined;
  let identityChanged = false;
  let enrollmentChanged = false;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    if (!adminHasPermission(admin, "students.manage")) throw new AcademicYearProblem(PERMISSION_DENIED_MESSAGE);

    await lockAcademicMutation(client);
    const year = await client.query("SELECT id FROM academic_years WHERE id=$1::bigint FOR UPDATE", [yearId]);
    if (!year.rowCount) throw new AcademicYearProblem("Tahun ajaran tidak ditemukan.");

    const klass = await client.query<{ label: string }>(
      `SELECT c.level || ' ' || m.name AS label FROM school_classes c JOIN school_majors m ON m.id=c.major_id
       WHERE c.id=$1::bigint FOR SHARE OF c,m`,
      [classId],
    );
    if (!klass.rowCount) throw new AcademicYearProblem("Kelas tidak ditemukan.");

    const studentRow = (
      await client.query<{ name: string; nisn: string; version: string }>(
        `SELECT name, nisn, to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
         FROM school_students WHERE id=$1::bigint FOR UPDATE`,
        [studentId],
      )
    ).rows[0];
    if (!studentRow || studentRow.version !== studentVersion) {
      throw new AcademicYearProblem("Data identitas siswa berubah atau sudah dihapus. Muat ulang dan periksa kembali.");
    }

    const enrollmentRow = (
      await client.query<{ id: string; classId: string; status: string; revision: string }>(
        `SELECT id::text AS id, class_id::text AS "classId", status, xmin::text AS revision
         FROM academic_year_enrollments
         WHERE academic_year_id=$1::bigint AND student_id=$2::bigint FOR UPDATE`,
        [yearId, studentId],
      )
    ).rows[0];
    if (!enrollmentRow || enrollmentRow.id !== enrollmentId || enrollmentRow.revision !== revision) {
      throw new AcademicYearProblem("Data siswa pada tahun ini berubah. Muat ulang dan periksa kembali.");
    }

    identityChanged = studentRow.name !== parsed.value.name || studentRow.nisn !== parsed.value.nisn;
    enrollmentChanged = enrollmentRow.classId !== classId || enrollmentRow.status !== String(status);

    if (identityChanged) {
      const updatedStudent = await client.query(
        `UPDATE school_students
         SET name=$1, nisn=$2, updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
         WHERE id=$3::bigint AND updated_at=$4::timestamptz
         RETURNING id`,
        [parsed.value.name, parsed.value.nisn, studentId, studentVersion],
      );
      if (!updatedStudent.rowCount) {
        throw new AcademicYearProblem("Data identitas siswa berubah atau sudah dihapus. Muat ulang dan periksa kembali.");
      }
    }

    if (enrollmentChanged) {
      await client.query(
        `UPDATE academic_year_enrollments
         SET class_id=$1::bigint, class_name_snapshot=$2, status=$3, transition='manual', updated_at=clock_timestamp()
         WHERE id=$4::bigint`,
        [classId, klass.rows[0].label, status, enrollmentId],
      );
      await syncYearPlacements(client, yearId, [studentId]);
    }

    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    await client.query("COMMIT");

    for (const path of REVALIDATE_STUDENT_PATHS) revalidatePath(path);
    return {
      ok: true,
      message: enrollmentChanged
        ? "Data siswa dan penempatan tahun ajaran diperbarui; riwayat penempatan tetap disimpan."
        : "Data siswa berhasil diperbarui.",
    };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof AcademicYearProblem) return { ok: false, error: error.message };
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return { ok: false, error: "NISN sudah digunakan oleh siswa lain." };
    }
    return { ok: false, error: "Hasil penyimpanan belum dapat dipastikan. Muat ulang roster sebelum mencoba lagi." };
  } finally {
    client?.release();
  }
}
