-- Tanda ragu tidak mengubah jawaban maupun penilaian. Kolom default hanya
-- menambahkan status untuk pengerjaan lama, tanpa menulis ulang jawabannya.
ALTER TABLE exam_attempt_questions
  ADD COLUMN is_doubtful boolean NOT NULL DEFAULT false,
  ADD COLUMN doubt_revision bigint NOT NULL DEFAULT 0
    CONSTRAINT exam_attempt_doubt_revision_check CHECK (doubt_revision >= 0);

-- Satu kebijakan untuk seluruh tes. Pembatas ini berlaku pada pengumpulan
-- manual, bukan penyelesaian otomatis ketika deadline benar-benar habis.
CREATE TABLE exam_work_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  submission_window_minutes integer NOT NULL DEFAULT 5
    CONSTRAINT exam_work_submission_window_check CHECK (submission_window_minutes BETWEEN 1 AND 10080),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(updated_at)),
  updated_by bigint REFERENCES admin_users(id) ON DELETE SET NULL
);
INSERT INTO exam_work_settings(id) VALUES (1);
