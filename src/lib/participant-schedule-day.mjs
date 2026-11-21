// Fragmen SQL tetap (tidak menerima data dari browser). Alias r adalah
// exam_schedule_runs. statement_timestamp() membuat semua batas tanggal dan
// status dalam satu query memakai saat yang sama dari PostgreSQL.
export const PARTICIPANT_SCHEDULE_DAY_JOIN = `CROSS JOIN LATERAL (
  SELECT (r.starts_at AT TIME ZONE (CASE r.time_zone WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END))::date AS start_day,
    (statement_timestamp() AT TIME ZONE (CASE r.time_zone WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END))::date AS today
) local_days`;

export const PARTICIPANT_SCHEDULE_DAY_FILTER = `(local_days.start_day = local_days.today
  OR (local_days.start_day = local_days.today - 1 AND r.starts_at <= statement_timestamp()
    AND r.starts_at + r.duration_minutes * interval '1 minute' > statement_timestamp()))`;
