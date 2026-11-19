-- Tahap administrasi rancangan tes. Belum ada publikasi, token, attempt,
-- atau penilaian. Soal yang dipilih merujuk bank soal terkini; modul attempt
-- kelak WAJIB menyimpan snapshot isi, gambar, opsi, kunci, dan urutan dalam
-- satu transaksi sebelum peserta mengerjakan. Jangan memakai relasi ini saja
-- untuk membaca ulang atau menilai riwayat attempt.
CREATE TABLE exam_tests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_id bigint NOT NULL REFERENCES exam_periods(id) ON DELETE RESTRICT,
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  duration_minutes integer NOT NULL,
  shuffle_questions boolean NOT NULL DEFAULT false,
  shuffle_options boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_tests_name_check CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100 AND name !~ '[[:cntrl:]]'),
  CONSTRAINT exam_tests_time_zone_check CHECK (time_zone IN ('WIB', 'WITA', 'WIT')),
  CONSTRAINT exam_tests_duration_check CHECK (duration_minutes BETWEEN 1 AND 10080),
  CONSTRAINT exam_tests_start_range_check CHECK (starts_at >= TIMESTAMPTZ '1999-12-31 15:00:00+00' AND starts_at < TIMESTAMPTZ '2101-01-01 00:00:00+00')
);

CREATE INDEX exam_tests_period_id_idx ON exam_tests (period_id);
CREATE INDEX exam_tests_starts_at_idx ON exam_tests (starts_at, id);

-- Posisi mempertahankan urutan yang dipilih admin saat acak tidak aktif.
-- Soal yang dipakai rancangan tidak dapat dihapus sampai dilepas dari tes.
CREATE TABLE exam_test_questions (
  exam_test_id bigint NOT NULL REFERENCES exam_tests(id) ON DELETE CASCADE,
  question_id bigint NOT NULL REFERENCES question_bank(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 1000),
  PRIMARY KEY (exam_test_id, question_id),
  CONSTRAINT exam_test_questions_position_unique UNIQUE (exam_test_id, position)
);

CREATE INDEX exam_test_questions_question_id_idx ON exam_test_questions (question_id);
