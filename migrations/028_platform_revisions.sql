-- Mode aplikasi (dev / production) dan default rentang tanggal timeline (1-7 hari)
ALTER TABLE app_settings
  ADD COLUMN app_mode varchar(16) NOT NULL DEFAULT 'production'
    CHECK (app_mode IN ('dev', 'production')),
  ADD COLUMN timeline_default_days smallint NOT NULL DEFAULT 7
    CHECK (timeline_default_days BETWEEN 1 AND 7);

-- Dukungan tag pada mata pelajaran / topik agar nama ringkas tetap unik per kombinasi tag
ALTER TABLE question_topics
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN tags_signature text NOT NULL DEFAULT '';

ALTER TABLE question_topics
  ADD CONSTRAINT question_topics_tags_check CHECK (
    (array_ndims(tags) IS NULL OR array_ndims(tags) = 1)
    AND cardinality(tags) <= 10
    AND NOT ('' = ANY(tags))
  );

DROP INDEX question_topics_name_ci_idx;
CREATE UNIQUE INDEX question_topics_name_tags_ci_idx
  ON question_topics (lower(name), tags_signature);

-- Status aktif multi-periode pada exam_periods (mengontrol login peserta)
ALTER TABLE exam_periods
  ADD COLUMN is_active boolean NOT NULL DEFAULT false;

UPDATE exam_periods p
SET is_active = true
FROM participant_login_settings s
WHERE s.id = 1 AND s.period_id = p.id;
