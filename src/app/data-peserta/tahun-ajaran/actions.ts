"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, PERMISSION_DENIED_MESSAGE, requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { AcademicYearProblem, lockAcademicMutation, syncYearPlacements } from "@/lib/academic-year-service";
import { parseRolloverChoices, suggestedPromotion, validateAcademicYearName, type AcademicClass } from "@/lib/academic-year.mjs";
import { validDataId } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";

export type Result = { ok: true; message: string } | { ok: false; error: string };
export type RolloverRow = { studentId: string; name: string; nisn: string; classId: string; className: string; level: string; majorId: string; revision: string; suggestedClassId: string | null; alreadyExists: boolean };
export type RolloverPreview = { sourceName: string; targetName: string; rows: RolloverRow[]; classes: AcademicClass[]; token: string; conflicts: number };

function message(error: unknown, fallback: string) {
  if (error instanceof AcademicYearProblem) return error.message;
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return "Data sudah ada atau berubah di sesi lain. Muat ulang dan periksa kembali.";
  return fallback;
}
function updatePaths() {
  for (const path of ["/data-peserta/tahun-ajaran", "/data-peserta/periode", "/data-peserta/siswa", "/peserta/login", "/peserta"]) revalidatePath(path);
}

export async function createAcademicYear(form: FormData): Promise<Result> {
  const { allowed } = await requireAdminAccess("academic_years.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const parsed = validateAcademicYearName(form.get("name"));
  if (!parsed.ok) return parsed;
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    if (!adminHasPermission(admin, "academic_years.manage")) throw new AcademicYearProblem(PERMISSION_DENIED_MESSAGE);
    await lockAcademicMutation(client);
    await client.query("INSERT INTO academic_years(name) VALUES($1)", [parsed.value]);
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    await client.query("COMMIT"); updatePaths();
    return { ok: true, message: `Tahun ajaran ${parsed.value} ditambahkan; belum diaktifkan.` };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); return { ok: false, error: message(error, "Tahun ajaran belum dapat disimpan. Periksa koneksi dan muat ulang.") }; }
  finally { client.release(); }
}

/** Perubahan tahun, pemutusan periode login dan pencabutan sesi bersifat atomik. */
export async function setActiveAcademicYear(form: FormData): Promise<Result> {
  const { allowed } = await requireAdminAccess("academic_years.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const targetRaw = form.get("yearId"); const expectedRaw = form.get("expectedYearId"); const revision = form.get("revision");
  const target = targetRaw === "" ? null : validDataId(targetRaw);
  const expected = expectedRaw === "" ? null : validDataId(expectedRaw);
  if (typeof targetRaw !== "string" || typeof expectedRaw !== "string" || (targetRaw && !target) || (expectedRaw && !expected) ||
      typeof revision !== "string" || !/^(0|[1-9]\d{0,18})$/.test(revision) || BigInt(revision) > BigInt("9223372036854775807")) {
    return { ok: false, error: "Pengaturan tahun tidak valid. Muat ulang halaman." };
  }
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    if (!adminHasPermission(admin, "academic_years.manage")) throw new AcademicYearProblem(PERMISSION_DENIED_MESSAGE);
    await lockAcademicMutation(client);
    const current = await client.query<{ id: string | null; revision: string }>(
      'SELECT active_year_id::text AS id,revision::text AS revision FROM academic_year_settings WHERE id=1 FOR UPDATE',
    );
    if (current.rowCount !== 1 || current.rows[0].id !== expected || current.rows[0].revision !== revision) throw new AcademicYearProblem("Tahun aktif sudah berubah di sesi lain. Muat ulang sebelum mencoba lagi.");
    if (target) {
      const year = await client.query("SELECT id FROM academic_years WHERE id=$1::bigint FOR SHARE", [target]);
      if (!year.rowCount) throw new AcademicYearProblem("Tahun ajaran tidak ditemukan.");
    }
    if (target !== expected) {
      await client.query("UPDATE academic_year_settings SET active_year_id=$1::bigint,revision=revision+1 WHERE id=1", [target]);
      await client.query("UPDATE exam_periods SET is_active=false,updated_at=clock_timestamp() WHERE is_active=true");
      await client.query("UPDATE participant_login_settings SET period_id=NULL WHERE id=1");
      await client.query("DELETE FROM participant_sessions");
    }
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    await client.query("COMMIT"); updatePaths();
    return { ok: true, message: target === expected ? "Tahun aktif tidak berubah." : target ? "Tahun ajaran diaktifkan. Login periode lama dinonaktifkan dan sesi peserta diakhiri." : "Tahun ajaran dan login peserta dinonaktifkan; sesi peserta diakhiri." };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); return { ok: false, error: message(error, "Pengaturan tahun belum dapat dipastikan. Muat ulang halaman.") }; }
  finally { client.release(); }
}

type SourceRow = Omit<RolloverRow, "suggestedClassId" | "alreadyExists">;
async function rolloverPlan(client: PoolClient, sourceId: string, targetId: string, lock: boolean): Promise<RolloverPreview> {
  const years = (await client.query<{ id: string; name: string }>(
    `SELECT id::text AS id,name FROM academic_years WHERE id=ANY($1::bigint[]) ORDER BY id ${lock ? "FOR UPDATE" : ""}`, [[sourceId, targetId]],
  )).rows;
  const sourceName = years.find((y) => y.id === sourceId)?.name; const targetName = years.find((y) => y.id === targetId)?.name;
  if (!sourceName || !targetName || sourceId === targetId) throw new AcademicYearProblem("Pilih dua tahun ajaran yang berbeda.");
  const sourceRows = (await client.query<SourceRow>(
    `SELECT s.id::text AS "studentId",s.name,s.nisn,e.class_id::text AS "classId",e.class_name_snapshot AS "className",
       c.level,c.major_id::text AS "majorId",e.xmin::text AS revision
     FROM academic_year_enrollments e JOIN school_students s ON s.id=e.student_id JOIN school_classes c ON c.id=e.class_id
     WHERE e.academic_year_id=$1::bigint AND e.status='active' ORDER BY e.student_id LIMIT 5001 ${lock ? "FOR UPDATE OF e,s" : ""}`, [sourceId],
  )).rows;
  if (sourceRows.length > 5000) throw new AcademicYearProblem("Maksimal 5.000 siswa aktif per perpindahan. Hubungi pengelola untuk bantuan.");
  const classes = (await client.query<AcademicClass>(
    `SELECT c.id::text AS id,c.level,c.major_id::text AS "majorId",c.level || ' ' || m.name AS label
     FROM school_classes c JOIN school_majors m ON m.id=c.major_id ORDER BY c.id ${lock ? "FOR SHARE OF c,m" : ""}`,
  )).rows;
  const existing = (await client.query<{ studentId: string }>(
    `SELECT student_id::text AS "studentId" FROM academic_year_enrollments
     WHERE academic_year_id=$1::bigint AND student_id=ANY($2::bigint[]) ORDER BY student_id ${lock ? "FOR UPDATE" : ""}`,
    [targetId, sourceRows.map((r) => r.studentId)],
  )).rows;
  const found = new Set(existing.map((r) => r.studentId));
  const rows = sourceRows.map((r) => ({ ...r, suggestedClassId: suggestedPromotion(r, classes), alreadyExists: found.has(r.studentId) }));
  const token = createHash("sha256").update(JSON.stringify({ sourceId, targetId, sourceName, targetName, rows, classes })).digest("hex");
  return { sourceName, targetName, rows, classes, token, conflicts: existing.length };
}

export async function previewAcademicRollover(source: string, target: string): Promise<{ ok: true; preview: RolloverPreview } | { ok: false; error: string }> {
  const { allowed } = await requireAdminAccess("academic_years.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const sourceId = validDataId(source); const targetId = validDataId(target);
  if (!sourceId || !targetId || sourceId === targetId) return { ok: false, error: "Pilih tahun asal dan tujuan yang berbeda." };
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    if (!adminHasPermission(admin, "academic_years.manage")) throw new AcademicYearProblem(PERMISSION_DENIED_MESSAGE);
    const preview = await rolloverPlan(client, sourceId, targetId, false);
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    await client.query("COMMIT"); return { ok: true, preview };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); return { ok: false, error: message(error, "Pratinjau belum dapat dibuat. Periksa database.") }; }
  finally { client.release(); }
}

export async function applyAcademicRollover(form: FormData): Promise<Result> {
  const { allowed } = await requireAdminAccess("academic_years.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const source = validDataId(form.get("source")); const target = validDataId(form.get("target")); const token = form.get("token");
  const choices = parseRolloverChoices(form.get("choices"));
  if (!source || !target || source === target || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) || !choices) return { ok: false, error: "Rencana perpindahan tidak valid. Buat pratinjau ulang." };
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    if (!adminHasPermission(admin, "academic_years.manage")) throw new AcademicYearProblem(PERMISSION_DENIED_MESSAGE);
    await lockAcademicMutation(client);
    const plan = await rolloverPlan(client, source, target, true);
    if (plan.token !== token) throw new AcademicYearProblem("Data berubah setelah pratinjau. Tidak ada perubahan; buat pratinjau ulang.");
    const selected = new Map(choices.map((c) => [c.studentId, c]));
    if (selected.size !== plan.rows.length || plan.rows.some((r) => !selected.has(r.studentId))) throw new AcademicYearProblem("Semua siswa harus diperiksa sebelum menyimpan.");
    const classes = new Map(plan.classes.map((c) => [c.id, c]));
    for (const row of plan.rows) {
      const choice = selected.get(row.studentId)!;
      if (row.alreadyExists) {
        if (choice.action !== "keep") throw new AcademicYearProblem("Siswa yang sudah ada pada tahun tujuan tidak boleh ditimpa. Buat pratinjau ulang.");
        continue;
      }
      if (choice.action === "keep") throw new AcademicYearProblem("Keputusan siswa tidak sesuai dengan data tujuan.");
      const status = choice.action === "graduated" ? "graduated" : choice.action === "left" ? "left" : "active";
      const classInfo = status === "active" ? classes.get(choice.classId) : classes.get(row.classId);
      if (!classInfo) throw new AcademicYearProblem(`Pilih kelas tujuan yang valid untuk ${row.name}.`);
      await client.query(
        `INSERT INTO academic_year_enrollments(academic_year_id,student_id,class_id,class_name_snapshot,status,source_year_id,transition)
         VALUES($1::bigint,$2::bigint,$3::bigint,$4,$5,$6::bigint,$7)`,
        [target, row.studentId, classInfo.id, classInfo.label, status, source, choice.action],
      );
    }
    await syncYearPlacements(client, target, plan.rows.map((r) => r.studentId));
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new AcademicYearProblem("Sesi admin berakhir. Masuk kembali.");
    await client.query("COMMIT"); updatePaths();
    return { ok: true, message: `${plan.rows.length - plan.conflicts} siswa ditambahkan ke tahun ${plan.targetName}; ${plan.conflicts} yang sudah ada tidak diubah. Riwayat tahun asal tetap tersimpan.` };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); return { ok: false, error: message(error, "Hasil perpindahan belum dapat dipastikan. Periksa roster tujuan sebelum mencoba lagi.") }; }
  finally { client.release(); }
}
