import "server-only";
import type { CardFilters } from "@/lib/participant-card-filter.mjs";

// Daftar menggunakan hanya kelas dan pencarian nama/NISN/username. Periode
// ditetapkan server dari pengaturan login, bukan dipilih oleh pengguna.
export const cardFilterCondition = `p.period_id=$1::bigint AND p.ended_at IS NULL
  AND ($2::bigint IS NULL OR p.class_id=$2::bigint)
  AND ($3::text IS NULL OR strpos(lower(s.name),lower($3::text))>0 OR strpos(s.nisn,$3::text)>0
    OR strpos(lower(COALESCE(i.username,'')),lower($3::text))>0)`;

export function cardFilterValues(filters: CardFilters) {
  return [filters.periodId, filters.classId, filters.student];
}
