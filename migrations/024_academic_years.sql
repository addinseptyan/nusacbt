-- Tahun ajaran merupakan induk periode. Periode lama tidak ditebak tahunnya:
-- admin menghubungkannya secara eksplisit setelah memeriksa data.
CREATE TABLE academic_years (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40 AND name = btrim(name) AND name !~ '[[:cntrl:]]'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX academic_years_name_ci_idx ON academic_years (lower(name));

-- Satu baris: NULL berarti tidak ada tahun yang aktif. Revisi mencegah
-- formulir yang sudah usang mengaktifkan ulang setelah perubahan A-B-A.
CREATE TABLE academic_year_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  active_year_id bigint REFERENCES academic_years(id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO academic_year_settings(id) VALUES (1);

ALTER TABLE exam_periods ADD COLUMN academic_year_id bigint REFERENCES academic_years(id) ON DELETE RESTRICT;
CREATE INDEX exam_periods_academic_year_idx ON exam_periods (academic_year_id, id);

-- Riwayat satu siswa per tahun. Siswa lulus/keluar tetap berada pada tahun
-- tujuan sebagai riwayat, tetapi tidak menghasilkan penempatan aktif periode.
CREATE TABLE academic_year_enrollments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  academic_year_id bigint NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  student_id bigint NOT NULL REFERENCES school_students(id) ON DELETE RESTRICT,
  class_id bigint NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  class_name_snapshot text NOT NULL CHECK (char_length(btrim(class_name_snapshot)) BETWEEN 1 AND 100 AND class_name_snapshot !~ '[[:cntrl:]]'),
  status text NOT NULL CHECK (status IN ('active','graduated','left')),
  source_year_id bigint REFERENCES academic_years(id) ON DELETE RESTRICT,
  transition text NOT NULL DEFAULT 'manual' CHECK (transition IN ('manual','promoted','repeated','graduated','left','legacy')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (academic_year_id, student_id),
  CHECK (source_year_id IS NULL OR source_year_id <> academic_year_id),
  CHECK ((status = 'active' AND transition IN ('manual','promoted','repeated','legacy'))
    OR (status = 'graduated' AND transition IN ('manual','graduated'))
    OR (status = 'left' AND transition IN ('manual','left')))
);
CREATE INDEX academic_year_enrollments_year_status_idx ON academic_year_enrollments (academic_year_id, status, class_id, student_id);
CREATE INDEX academic_year_enrollments_student_idx ON academic_year_enrollments (student_id, academic_year_id);

-- Selama periode lama belum dipetakan, tidak ada tahun aktif yang dapat
-- memvalidasi login. Akhiri sesi dan nonaktifkan login pada upgrade; akun,
-- sandi, penempatan, jadwal, pengerjaan dan nilai tidak dihapus.
UPDATE participant_login_settings SET period_id = NULL WHERE id = 1 AND period_id IS NOT NULL;
DELETE FROM participant_sessions;
