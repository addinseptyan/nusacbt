CREATE TABLE school_students (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  nisn text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_students_name_check CHECK (
    char_length(name) BETWEEN 1 AND 100 AND char_length(btrim(name)) > 0 AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT school_students_nisn_check CHECK (nisn ~ '^[0-9]{10}$'),
  CONSTRAINT school_students_nisn_key UNIQUE (nisn)
);

CREATE TABLE student_class_placements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id bigint NOT NULL REFERENCES school_students(id) ON DELETE RESTRICT,
  period_id bigint NOT NULL REFERENCES exam_periods(id) ON DELETE RESTRICT,
  class_id bigint NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  class_name_snapshot text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT student_class_placements_name_check CHECK (
    char_length(class_name_snapshot) BETWEEN 1 AND 100 AND
    char_length(btrim(class_name_snapshot)) > 0 AND class_name_snapshot !~ '[[:cntrl:]]'
  ),
  CONSTRAINT student_class_placements_dates_check CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- Satu siswa hanya boleh memiliki satu penempatan aktif dalam satu periode.
-- Penempatan yang diakhiri tetap disimpan sebagai riwayat.
CREATE UNIQUE INDEX student_class_placements_one_active_idx
  ON student_class_placements (student_id, period_id) WHERE ended_at IS NULL;
CREATE INDEX student_class_placements_student_history_idx
  ON student_class_placements (student_id, period_id, started_at DESC, id DESC);
CREATE INDEX student_class_placements_period_idx ON student_class_placements (period_id);
CREATE INDEX student_class_placements_class_idx ON student_class_placements (class_id);
