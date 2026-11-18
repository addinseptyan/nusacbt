-- Identitas peserta berlaku per siswa dan periode; kolom Nomor pada impor Excel
-- tetap hanya nomor urut. Kata sandi, login, dan kartu belum disimpan di sini.
CREATE TABLE participant_identities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id bigint NOT NULL REFERENCES school_students(id) ON DELETE RESTRICT,
  period_id bigint NOT NULL REFERENCES exam_periods(id) ON DELETE RESTRICT,
  participant_number text NOT NULL,
  username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participant_identities_student_period_key UNIQUE (period_id, student_id),
  CONSTRAINT participant_identities_number_check CHECK (
    participant_number COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  ),
  CONSTRAINT participant_identities_username_check CHECK (
    username COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
  )
);

-- Huruf besar/kecil tidak membedakan identitas dalam periode yang sama.
CREATE UNIQUE INDEX participant_identities_number_period_ci_idx
  ON participant_identities (period_id, lower(participant_number COLLATE "C"));
CREATE UNIQUE INDEX participant_identities_username_period_ci_idx
  ON participant_identities (period_id, lower(username COLLATE "C"));
CREATE INDEX participant_identities_student_idx ON participant_identities (student_id);
