-- Pembaruan zona waktu terpusat, pembersihan kolom usang pengaturan aplikasi, serta tag pada rancangan tes.
ALTER TABLE app_settings
  ADD COLUMN default_time_zone varchar(8) NOT NULL DEFAULT 'WIB'
    CHECK (default_time_zone IN ('WIB', 'WITA', 'WIT')),
  DROP CONSTRAINT IF EXISTS app_settings_letterhead_image_check,
  DROP COLUMN IF EXISTS timeline_default_days,
  DROP COLUMN IF EXISTS letterhead_image,
  DROP COLUMN IF EXISTS letterhead_image_mime;

ALTER TABLE exam_tests
  ADD COLUMN tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN tags_signature text NOT NULL DEFAULT '';

ALTER TABLE exam_tests
  ADD CONSTRAINT exam_tests_tags_check CHECK (
    (array_ndims(tags) IS NULL OR array_ndims(tags) = 1)
    AND cardinality(tags) <= 10
    AND NOT ('' = ANY(tags))
  );

CREATE INDEX exam_tests_tags_gin_idx ON exam_tests USING gin (tags);

-- Urutkan tag mata pelajaran yang sudah ada secara alfabetis (case-insensitive)
UPDATE question_topics qt
SET tags = sorted.tags,
    tags_signature = sorted.sig
FROM (
  SELECT id,
    COALESCE(
      (SELECT array_agg(t ORDER BY lower(t), t) FROM unnest(tags) AS t),
      ARRAY[]::text[]
    ) AS tags,
    COALESCE(
      (SELECT string_agg(lower(t), E'\x1f' ORDER BY lower(t), t) FROM unnest(tags) AS t),
      ''
    ) AS sig
  FROM question_topics
  WHERE cardinality(tags) >= 1
) sorted
WHERE qt.id = sorted.id
  AND (qt.tags IS DISTINCT FROM sorted.tags OR qt.tags_signature IS DISTINCT FROM sorted.sig);
