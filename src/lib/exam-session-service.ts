import "server-only";
import type { PoolClient } from "pg";

import { lockActiveAdminSession } from "@/lib/admin-auth";
import { validateSessionPlan } from "@/lib/exam-session-validation.mjs";
import type { ScheduleActionResult, SessionGroup, SessionPeriod, SessionPlanPage, SessionStudent } from "@/lib/exam-session-types";
import { getPostgresPool } from "@/lib/postgres";

class SessionPlanProblem extends Error {
  constructor(message: string, readonly reload = false) { super(message); }
}

// Không trả danh sách học sinh nếu phiên hết hạn trong khi tải dữ liệu.
export class ScheduleSessionExpired extends Error {}

function isDatabaseError(error: unknown, ...codes: string[]) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}

export async function loadSessionPlanWithClient(client: PoolClient, periodId: string | null): Promise<SessionPlanPage> {
    const periods = (await client.query<SessionPeriod>(
      `SELECT id::text AS id,name,to_char(start_date,'YYYY-MM-DD') AS "startDate" FROM exam_periods ORDER BY start_date DESC,id DESC`,
    )).rows;
    const selected = periods.find((p) => p.id === periodId) ?? null;
    if (!selected) {
      return { periods, selected: null, selectionMissing: periodId !== null, revision: null, groups: [], students: [] };
    }
    const plan = await client.query<{ revision: string }>("SELECT revision::text AS revision FROM exam_session_plans WHERE period_id=$1::bigint", [selected.id]);
    const groups = (await client.query<SessionGroup>(
      'SELECT session_number AS "sessionNumber",capacity FROM exam_session_groups WHERE period_id=$1::bigint ORDER BY session_number', [selected.id],
    )).rows;
    const students = (await client.query<SessionStudent>(
      `WITH target AS (
         SELECT student_id FROM student_class_placements WHERE period_id=$1::bigint AND ended_at IS NULL
         UNION SELECT student_id FROM exam_session_assignments WHERE period_id=$1::bigint
       )
       SELECT s.id::text AS "studentId",s.name AS "studentName",s.nisn,
         COALESCE(active.id,old.id)::text AS "placementId",
         COALESCE(active.class_id,old.class_id)::text AS "classId",
         CASE WHEN active.id IS NOT NULL THEN c.level || ' ' || m.name ELSE old.class_name_snapshot END AS "classLabel",
         active.id IS NOT NULL AS active,a.session_number AS "sessionNumber"
       FROM target x JOIN school_students s ON s.id=x.student_id
       LEFT JOIN student_class_placements active ON active.student_id=s.id AND active.period_id=$1::bigint AND active.ended_at IS NULL
       LEFT JOIN exam_session_assignments a ON a.student_id=s.id AND a.period_id=$1::bigint
       LEFT JOIN student_class_placements old ON old.id=a.placement_id
       LEFT JOIN school_classes c ON c.id=active.class_id LEFT JOIN school_majors m ON m.id=c.major_id
       ORDER BY lower(s.name),s.nisn,s.id`, [selected.id],
    )).rows;
    if (groups.some((group, index) => group.sessionNumber !== index + 1) ||
        (plan.rowCount === 0 && (groups.length || students.some((s) => s.sessionNumber !== null)))) throw new Error("Rencana sesi tidak konsisten.");
    return { periods, selected, selectionMissing: false, revision: plan.rows[0]?.revision ?? null, groups, students };
}

export async function loadSessionPlan(periodId: string | null): Promise<SessionPlanPage> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new ScheduleSessionExpired();
    const data = await loadSessionPlanWithClient(client, periodId);
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new ScheduleSessionExpired();
    await client.query("COMMIT");
    return data;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {}); throw error;
  } finally { client.release(); }
}

/** Seluruh perubahan kelompok disimpan atomik, tanpa mengubah jadwal rilis. */
export async function saveSessionPlanValue(raw: unknown): Promise<ScheduleActionResult> {
  const parsed = validateSessionPlan(raw);
  if (!parsed.ok) return parsed;
  const { periodId, expectedRevision, capacities, assignments } = parsed.value;
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new SessionPlanProblem("Sesi admin berakhir. Masuk kembali sebelum menyimpan.");
    // Mutasi rencana/jadwal per periode diserialkan dengan advisory lock,
    // tanpa berbenturan dengan lock periode pada impor dan penempatan siswa.
    if (!await lockSchedulePeriod(client, periodId)) throw new SessionPlanProblem("Periode sudah dihapus. Muat ulang halaman.", true);
    const plan = await client.query<{ revision: string }>("SELECT revision::text AS revision FROM exam_session_plans WHERE period_id=$1::bigint FOR UPDATE", [periodId]);
    if ((plan.rows[0]?.revision ?? null) !== expectedRevision) throw new SessionPlanProblem("Kelompok sesi telah berubah di tab lain. Muat ulang dan periksa kembali.", true);
    if (!plan.rowCount) await client.query("INSERT INTO exam_session_plans(period_id,updated_by) VALUES($1::bigint,$2::bigint)", [periodId, admin.id]);
    const oldRows = await client.query<{ studentId: string; placementId: string; sessionNumber: number }>(
      'SELECT student_id::text AS "studentId",placement_id::text AS "placementId",session_number AS "sessionNumber" FROM exam_session_assignments WHERE period_id=$1::bigint ORDER BY student_id', [periodId],
    );
    const old = new Map(oldRows.rows.map((row) => [row.studentId, row]));
    const proposed = new Map(assignments.map((row) => [row.studentId, row]));
    const ids = [...new Set([...old.keys(), ...proposed.keys()])];
    if (ids.length) {
      // Sama dengan perubahan penempatan: kunci siswa sebelum penempatannya.
      const locked = await client.query<{ id: string }>("SELECT id::text AS id FROM school_students WHERE id=ANY($1::bigint[]) ORDER BY id FOR SHARE", [ids]);
      if (locked.rowCount !== ids.length) throw new SessionPlanProblem("Ada siswa yang tidak ditemukan. Muat ulang halaman.", true);
      const placements = await client.query<{ studentId: string; id: string }>(
        `SELECT student_id::text AS "studentId",id::text AS id FROM student_class_placements
         WHERE period_id=$1::bigint AND student_id=ANY($2::bigint[]) AND ended_at IS NULL ORDER BY student_id FOR SHARE`, [periodId, ids],
      );
      const active = new Map(placements.rows.map((row) => [row.studentId, row.id]));
      for (const item of assignments) {
        const activeId = active.get(item.studentId); const prior = old.get(item.studentId);
        // Penempatan yang diakhiri tetap boleh dipertahankan tanpa dipindah.
        if (activeId ? activeId !== item.placementId : !prior || prior.placementId !== item.placementId || prior.sessionNumber !== item.sessionNumber) {
          throw new SessionPlanProblem("Penempatan siswa berubah atau tidak aktif. Muat ulang dan periksa pembagian.", true);
        }
      }
    }
    const published = await client.query<{ studentId: string; sessionNumber: number }>(
      `SELECT DISTINCT p.student_id::text AS "studentId",r.session_number AS "sessionNumber"
       FROM exam_schedule_runs r JOIN exam_schedule_participants p ON p.run_id=r.id
       WHERE r.period_id=$1::bigint AND r.kind='regular' AND r.published_at IS NOT NULL`, [periodId],
    );
    if (published.rows.some((row) => proposed.get(row.studentId)?.sessionNumber !== row.sessionNumber)) {
      throw new SessionPlanProblem("Ada siswa yang sudah memiliki jadwal reguler dirilis. Tarik rilis pelaksanaan terkait sebelum memindahkan atau mengeluarkan siswa itu.", true);
    }
    const usedGroups = await client.query<{ sessionNumber: number }>(
      'SELECT DISTINCT session_number AS "sessionNumber" FROM exam_schedule_runs WHERE period_id=$1::bigint AND kind=\'regular\'', [periodId],
    );
    if (usedGroups.rows.some((row) => row.sessionNumber > capacities.length)) {
      throw new SessionPlanProblem("Sesi yang akan dihapus masih digunakan pelaksanaan tes. Hapus pelaksanaan tersebut dahulu.", true);
    }
    await client.query(
      `INSERT INTO exam_session_groups(period_id,session_number,capacity)
       SELECT $1::bigint,ordinality::smallint,capacity FROM unnest($2::integer[]) WITH ORDINALITY AS g(capacity,ordinality)
       ON CONFLICT(period_id,session_number) DO UPDATE SET capacity=EXCLUDED.capacity`, [periodId, capacities],
    );
    await client.query("DELETE FROM exam_session_assignments WHERE period_id=$1::bigint AND NOT (student_id=ANY($2::bigint[]))", [periodId, assignments.map((item) => item.studentId)]);
    if (assignments.length) {
      await client.query(
        `INSERT INTO exam_session_assignments(period_id,student_id,session_number,placement_id)
         SELECT $1::bigint,x.student_id,x.session_number,x.placement_id
         FROM unnest($2::bigint[],$3::smallint[],$4::bigint[]) AS x(student_id,session_number,placement_id)
         ON CONFLICT(period_id,student_id) DO UPDATE SET session_number=EXCLUDED.session_number,placement_id=EXCLUDED.placement_id,
           assigned_at=CASE WHEN exam_session_assignments.session_number=EXCLUDED.session_number THEN exam_session_assignments.assigned_at ELSE clock_timestamp() END`,
        [periodId, assignments.map((x) => x.studentId), assignments.map((x) => x.sessionNumber), assignments.map((x) => x.placementId)],
      );
    }
    await client.query("DELETE FROM exam_session_groups WHERE period_id=$1::bigint AND session_number>$2::smallint", [periodId, capacities.length]);
    await client.query(
      "UPDATE exam_session_plans SET revision=revision+1,updated_by=$2::bigint,updated_at=clock_timestamp() WHERE period_id=$1::bigint", [periodId, admin.id],
    );
    const stillActive = await lockActiveAdminSession(client);
    if (!stillActive || stillActive.id !== admin.id) throw new SessionPlanProblem("Sesi admin berakhir. Masuk kembali sebelum menyimpan.");
    await client.query("COMMIT");
    return { ok: true, message: "Kelompok sesi disimpan. Siswa yang sudah dibagi tetap pada sesinya." };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof SessionPlanProblem) return { ok: false, error: error.message, reload: error.reload };
    if (isDatabaseError(error, "23503", "23001", "23505", "40001", "40P01")) return { ok: false, error: "Data berubah atau sesi masih digunakan. Tidak ada perubahan yang disimpan; muat ulang dan periksa kembali.", reload: true };
    return { ok: false, error: "Hasil penyimpanan belum dapat dipastikan. Periksa koneksi dan muat ulang sebelum mencoba lagi.", reload: true };
  } finally { client?.release(); }
}

/** Semua mutasi rencana/pelaksanaan dalam periode harus memakai pagar ini.
 * KEY SHARE menjaga periode dari penghapusan, tetapi kompatibel dengan FOR
 * SHARE impor siswa yang mengunci siswa lebih dahulu. */
export async function lockSchedulePeriod(client: PoolClient, periodId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('nusacbt:exam-schedule:period:' || $1::text, 0))", [periodId]);
  const result = await client.query("SELECT id FROM exam_periods WHERE id=$1::bigint FOR KEY SHARE", [periodId]);
  return result.rowCount === 1;
}
