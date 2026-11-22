import "server-only";
import type { PoolClient } from "pg";

/** Mutasi roster, pengaitan periode dan pergantian tahun memakai pagar yang
 * sama. Pengaturan login dikunci dulu, sama dengan urutan login peserta. */
export async function lockAcademicMutation(client: PoolClient) {
  const settings = await client.query("SELECT id FROM participant_login_settings WHERE id=1 FOR UPDATE");
  if (settings.rowCount !== 1) throw new Error("Pengaturan login tidak tersedia.");
  await client.query("SELECT pg_advisory_xact_lock($1)", [2026111724]);
}

/** Sinkronkan penempatan operasional per periode dari roster tahun. Riwayat
 * penempatan, jadwal dan snapshot pengerjaan tidak dihapus atau ditulis ulang.
 * Caller harus memegang lockAcademicMutation dalam transaksi. */
export async function syncYearPlacements(client: PoolClient, yearId: string, studentIds: string[] | null = null) {
  const ended = await client.query<{ id: string }>(
    `UPDATE student_class_placements p SET ended_at=GREATEST(clock_timestamp(),p.started_at)
     FROM exam_periods ep WHERE ep.id=p.period_id AND ep.academic_year_id=$1::bigint
       AND p.ended_at IS NULL AND ($2::bigint[] IS NULL OR p.student_id=ANY($2::bigint[]))
       AND NOT EXISTS (SELECT 1 FROM academic_year_enrollments e
         WHERE e.academic_year_id=ep.academic_year_id AND e.student_id=p.student_id AND e.status='active' AND e.class_id=p.class_id)
     RETURNING p.id::text AS id`, [yearId, studentIds],
  );
  if (ended.rowCount) {
    // Penempatan sebelumnya tidak lagi aktif; sesi yang menunjuk ke sana
    // dihapus dalam transaksi yang sama, tanpa mengubah akun atau sandi.
    await client.query("DELETE FROM participant_sessions WHERE placement_id=ANY($1::bigint[])", [ended.rows.map((r) => r.id)]);
  }
  await client.query(
    `INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot)
     SELECT e.student_id,ep.id,e.class_id,e.class_name_snapshot
     FROM academic_year_enrollments e JOIN exam_periods ep ON ep.academic_year_id=e.academic_year_id
     WHERE e.academic_year_id=$1::bigint AND e.status='active'
       AND ($2::bigint[] IS NULL OR e.student_id=ANY($2::bigint[]))
       AND NOT EXISTS (SELECT 1 FROM student_class_placements p WHERE p.student_id=e.student_id AND p.period_id=ep.id AND p.ended_at IS NULL)
     ORDER BY e.student_id,ep.id`, [yearId, studentIds],
  );
}

export class AcademicYearProblem extends Error {}

/** Hubungkan periode lama yang belum dipetakan. Konflik kelas/status tidak
 * diselesaikan otomatis. Riwayat ujian, akun, dan penempatan lama tetap utuh. */
export async function attachPeriodToYear(client: PoolClient, periodId: string, yearId: string) {
  const period = await client.query<{ yearId: string | null }>(
    'SELECT academic_year_id::text AS "yearId" FROM exam_periods WHERE id=$1::bigint FOR UPDATE', [periodId],
  );
  if (!period.rowCount) throw new AcademicYearProblem("Periode tidak ditemukan.");
  if (period.rows[0].yearId && period.rows[0].yearId !== yearId) throw new AcademicYearProblem("Tahun ajaran periode yang sudah dipetakan tidak dapat diganti otomatis.");
  const year = await client.query("SELECT id FROM academic_years WHERE id=$1::bigint FOR UPDATE", [yearId]);
  if (!year.rowCount) throw new AcademicYearProblem("Tahun ajaran tidak ditemukan.");
  if (period.rows[0].yearId) return;
  const conflict = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM student_class_placements p
     JOIN academic_year_enrollments e ON e.academic_year_id=$2::bigint AND e.student_id=p.student_id
     WHERE p.period_id=$1::bigint AND p.ended_at IS NULL AND (e.status<>'active' OR e.class_id<>p.class_id)`,
    [periodId, yearId],
  );
  if (conflict.rows[0].count) throw new AcademicYearProblem(`Ada ${conflict.rows[0].count} siswa dengan kelas/status berbeda pada tahun tujuan. Periksa penempatan lama dan roster tahun terlebih dahulu; tidak ada perubahan.`);
  await client.query("UPDATE exam_periods SET academic_year_id=$2::bigint,updated_at=clock_timestamp() WHERE id=$1::bigint", [periodId, yearId]);
  await client.query(
    `INSERT INTO academic_year_enrollments(academic_year_id,student_id,class_id,class_name_snapshot,status,transition)
     SELECT $2::bigint,p.student_id,p.class_id,p.class_name_snapshot,'active','legacy'
     FROM student_class_placements p WHERE p.period_id=$1::bigint AND p.ended_at IS NULL
     ON CONFLICT (academic_year_id,student_id) DO NOTHING`, [periodId, yearId],
  );
  await syncYearPlacements(client, yearId);
}
