import "server-only";

// Token tetap satu slot per tes induk, bukan satu slot per pelaksanaan. Jika
// tes memiliki pelaksanaan (draf maupun rilis), gunakan waktunya; bila belum
// ada, pertahankan perilaku jadwal dasar untuk kompatibilitas tes lama.
// SQL ini hanya digunakan dengan alias exam_tests `t` yang ditentukan server.
export const TOKEN_TEST_ELIGIBLE = `(EXISTS (
  SELECT 1 FROM exam_schedule_runs r WHERE r.exam_test_id=t.id
    AND r.starts_at + r.duration_minutes * interval '1 minute' > clock_timestamp()
) OR (NOT EXISTS (SELECT 1 FROM exam_schedule_runs r WHERE r.exam_test_id=t.id)
  AND t.starts_at + t.duration_minutes * interval '1 minute' > clock_timestamp()))`;

// Argumen: $1 sekarang, $2 awal filter (atau NULL), $3 akhir filter. Pilih
// satu jadwal yang cocok per tes agar filter dan paginasi tidak menggandakan
// token. Saat suatu sesi berakhir, refresh halaman akan memilih sesi berikut.
export const TOKEN_SCHEDULE_LATERAL = `CROSS JOIN LATERAL (
  SELECT s.starts_at, s.ends_at, s.time_zone, s.label, s.kind, s.published
  FROM (
    SELECT r.starts_at, r.starts_at + r.duration_minutes * interval '1 minute' AS ends_at,
      r.time_zone, r.label, r.kind, (r.published_at IS NOT NULL) AS published, r.id
    FROM exam_schedule_runs r WHERE r.exam_test_id=t.id
    UNION ALL
    SELECT t.starts_at, t.starts_at + t.duration_minutes * interval '1 minute',
      t.time_zone, NULL::text, NULL::text, false, 0::bigint
    WHERE NOT EXISTS (SELECT 1 FROM exam_schedule_runs r WHERE r.exam_test_id=t.id)
  ) s
  WHERE s.ends_at > $1::timestamptz
    AND ($2::timestamptz IS NULL OR (s.starts_at < $3::timestamptz AND s.ends_at > $2::timestamptz))
  ORDER BY (s.starts_at <= $1::timestamptz) DESC, s.starts_at, s.id
  LIMIT 1
) sched`;
