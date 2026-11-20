-- Kelompok sesi adalah daftar siswa yang dibekukan per periode. Migrasi ini
-- tidak mengisi daftar siswa, mengubah rancangan tes, atau menerbitkan jadwal.
-- Jadwal lama tidak ditampilkan peserta sampai pelaksanaannya diatur/dirilis.
CREATE UNIQUE INDEX exam_tests_id_period_unique ON exam_tests (id, period_id);
CREATE UNIQUE INDEX student_class_placements_id_student_period_unique
  ON student_class_placements (id, student_id, period_id);

CREATE TABLE exam_session_plans (
  period_id bigint PRIMARY KEY REFERENCES exam_periods(id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by bigint NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT
);

CREATE TABLE exam_session_groups (
  period_id bigint NOT NULL REFERENCES exam_session_plans(period_id) ON DELETE RESTRICT,
  session_number smallint NOT NULL CHECK (session_number BETWEEN 1 AND 24),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 5000),
  PRIMARY KEY (period_id, session_number)
);

CREATE TABLE exam_session_assignments (
  period_id bigint NOT NULL,
  student_id bigint NOT NULL,
  session_number smallint NOT NULL,
  placement_id bigint NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (period_id, student_id),
  FOREIGN KEY (period_id, session_number) REFERENCES exam_session_groups(period_id, session_number) ON DELETE RESTRICT,
  FOREIGN KEY (placement_id, student_id, period_id) REFERENCES student_class_placements(id, student_id, period_id) ON DELETE RESTRICT
);
CREATE INDEX exam_session_assignments_group_idx ON exam_session_assignments (period_id, session_number, student_id);

-- Tiap tes boleh memiliki beberapa sesi reguler (satu per nomor kelompok),
-- dan beberapa susulan/remidi. Semua pelaksanaan baru dimulai sebagai draf.
-- Soal mode inherit mengikuti rancangan induk. Mode custom khusus remidi.
CREATE TABLE exam_schedule_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exam_test_id bigint NOT NULL,
  period_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('regular', 'makeup', 'remedial')),
  label text NOT NULL CHECK (label = btrim(label) AND char_length(label) BETWEEN 1 AND 100 AND label !~ '[[:cntrl:]]'),
  session_number smallint,
  starts_at timestamptz NOT NULL,
  time_zone text NOT NULL CHECK (time_zone IN ('WIB', 'WITA', 'WIT')),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 10080),
  question_mode text NOT NULL DEFAULT 'inherit' CHECK (question_mode IN ('inherit', 'custom')),
  created_by bigint NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  published_by bigint REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT exam_schedule_run_period_fk FOREIGN KEY (exam_test_id, period_id) REFERENCES exam_tests(id, period_id) ON DELETE RESTRICT,
  CONSTRAINT exam_schedule_run_group_fk FOREIGN KEY (period_id, session_number) REFERENCES exam_session_groups(period_id, session_number) ON DELETE RESTRICT,
  CONSTRAINT exam_schedule_run_group_check CHECK ((kind = 'regular' AND session_number IS NOT NULL) OR (kind <> 'regular' AND session_number IS NULL)),
  CONSTRAINT exam_schedule_run_questions_check CHECK (kind = 'remedial' OR question_mode = 'inherit'),
  CONSTRAINT exam_schedule_run_publication_check CHECK ((published_at IS NULL) = (published_by IS NULL)),
  CONSTRAINT exam_schedule_run_start_check CHECK (starts_at >= TIMESTAMPTZ '1999-12-31 15:00:00+00' AND starts_at < TIMESTAMPTZ '2101-01-01 00:00:00+00'),
  CONSTRAINT exam_schedule_run_identity_unique UNIQUE (id, exam_test_id, period_id, kind)
);
CREATE UNIQUE INDEX exam_schedule_regular_group_unique ON exam_schedule_runs (exam_test_id, session_number) WHERE kind = 'regular';
CREATE INDEX exam_schedule_runs_test_starts_idx ON exam_schedule_runs (exam_test_id, starts_at, id);
CREATE INDEX exam_schedule_runs_period_published_idx ON exam_schedule_runs (period_id, starts_at, id) WHERE published_at IS NOT NULL;

-- Siswa tidak dapat didaftarkan ke dua sesi reguler dari tes yang sama.
-- Penempatan di sini adalah snapshot pilihan, bukan pengganti pemeriksaan
-- penempatan aktif saat peserta login. Susulan/remidi dapat dipilih terpisah.
CREATE TABLE exam_schedule_participants (
  run_id bigint NOT NULL,
  exam_test_id bigint NOT NULL,
  period_id bigint NOT NULL,
  kind text NOT NULL,
  student_id bigint NOT NULL,
  placement_id bigint NOT NULL,
  PRIMARY KEY (run_id, student_id),
  FOREIGN KEY (run_id, exam_test_id, period_id, kind) REFERENCES exam_schedule_runs(id, exam_test_id, period_id, kind) ON DELETE CASCADE,
  FOREIGN KEY (placement_id, student_id, period_id) REFERENCES student_class_placements(id, student_id, period_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX exam_schedule_one_regular_per_test_idx
  ON exam_schedule_participants (exam_test_id, student_id) WHERE kind = 'regular';
CREATE INDEX exam_schedule_participants_student_idx ON exam_schedule_participants (student_id, period_id, run_id);

CREATE TABLE exam_schedule_custom_questions (
  run_id bigint NOT NULL REFERENCES exam_schedule_runs(id) ON DELETE CASCADE,
  question_id bigint NOT NULL REFERENCES question_bank(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 1000),
  PRIMARY KEY (run_id, question_id),
  UNIQUE (run_id, position)
);
CREATE INDEX exam_schedule_custom_questions_question_idx ON exam_schedule_custom_questions (question_id);
