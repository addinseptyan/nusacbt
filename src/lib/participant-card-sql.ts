import "server-only";
import type { CardFilters } from "@/lib/participant-card-filter.mjs";

// Alias yang dipakai: p=penempatan aktif, s=siswa, i=identitas. Tes dan
// kategori harus cocok pada SATU pelaksanaan yang dirilis. EXISTS mencegah
// siswa berulang bila terdaftar pada lebih dari satu pelaksanaan.
export const cardFilterCondition = `p.period_id=$1::bigint AND p.ended_at IS NULL
  AND ($2::bigint IS NULL OR p.class_id=$2::bigint)
  AND ($5::text IS NULL OR strpos(lower(s.name),lower($5::text))>0 OR strpos(s.nisn,$5::text)>0
    OR strpos(lower(COALESCE(i.participant_number,'')),lower($5::text))>0
    OR strpos(lower(COALESCE(i.username,'')),lower($5::text))>0)
  AND (($3::bigint IS NULL AND $4::text IS NULL) OR EXISTS (
    SELECT 1 FROM exam_schedule_participants roster
    JOIN exam_schedule_runs run ON run.id=roster.run_id
    WHERE roster.student_id=s.id AND run.period_id=p.period_id AND run.published_at IS NOT NULL
      AND ($3::bigint IS NULL OR run.exam_test_id=$3::bigint)
      AND ($4::text IS NULL OR run.kind=$4::text)
  ))`;

export function cardFilterValues(filters: CardFilters) {
  return [filters.periodId, filters.classId, filters.testId, filters.kind, filters.student];
}
