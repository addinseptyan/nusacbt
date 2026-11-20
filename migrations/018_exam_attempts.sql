-- Pengerjaan peserta: belum membuat attempt, nilai, peserta, atau rilis apa pun
-- untuk tes yang sudah ada. Isi/kunci/gambar soal menjadi snapshot immutable;
-- satu versi snapshot dapat dibagi oleh beberapa attempt untuk menghemat ruang.
CREATE UNIQUE INDEX participant_identities_id_student_period_unique
  ON participant_identities (id, student_id, period_id);

CREATE TABLE exam_question_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_question_id bigint NOT NULL,
  source_revision text NOT NULL CHECK (source_revision ~ '^[0-9]+$'),
  source_updated_at timestamptz NOT NULL,
  prompt_text text NOT NULL,
  prompt_rich jsonb,
  has_prompt_image boolean NOT NULL,
  -- Pilihan disimpan menurut identitas asli A–E, bukan nomor setelah pengacakan.
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'object'),
  correct_option text NOT NULL CHECK (correct_option IN ('A','B','C','D','E')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_question_id, source_revision, source_updated_at)
);

CREATE TABLE exam_question_snapshot_images (
  snapshot_id bigint NOT NULL REFERENCES exam_question_snapshots(id) ON DELETE CASCADE,
  slot text NOT NULL CHECK (slot IN ('prompt','A','B','C','D','E')),
  mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg')),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1048576),
  PRIMARY KEY (snapshot_id, slot)
);

-- Mencegah perubahan diam-diam atas snapshot yang dapat dipakai beberapa
-- attempt. Penghapusan snapshot hanya boleh jika tidak direferensikan attempt.
CREATE FUNCTION reject_exam_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Snapshot soal tidak dapat diubah' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER exam_question_snapshots_immutable BEFORE UPDATE ON exam_question_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_exam_snapshot_update();
CREATE TRIGGER exam_question_snapshot_images_immutable BEFORE UPDATE ON exam_question_snapshot_images
  FOR EACH ROW EXECUTE FUNCTION reject_exam_snapshot_update();

CREATE TABLE exam_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id bigint NOT NULL,
  exam_test_id bigint NOT NULL,
  period_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('regular','makeup','remedial')),
  participant_identity_id bigint NOT NULL,
  student_id bigint NOT NULL,
  student_name_snapshot text NOT NULL,
  participant_number_snapshot text NOT NULL,
  class_name_snapshot text NOT NULL,
  test_name_snapshot text NOT NULL,
  run_label_snapshot text NOT NULL,
  time_zone_snapshot text NOT NULL CHECK (time_zone_snapshot IN ('WIB','WITA','WIT')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deadline timestamptz NOT NULL,
  question_count integer NOT NULL CHECK (question_count BETWEEN 1 AND 1000),
  completed_at timestamptz,
  completion_reason text CHECK (completion_reason IN ('submitted','time_expired')),
  correct_count integer,
  answered_count integer,
  CONSTRAINT exam_attempt_deadline_check CHECK (isfinite(started_at) AND isfinite(deadline) AND deadline > started_at),
  CONSTRAINT exam_attempt_completion_check CHECK (
    (completed_at IS NULL AND completion_reason IS NULL AND correct_count IS NULL AND answered_count IS NULL)
    OR (completed_at IS NOT NULL AND isfinite(completed_at) AND completion_reason IS NOT NULL
      AND correct_count IS NOT NULL AND answered_count IS NOT NULL AND completed_at >= started_at
      AND correct_count BETWEEN 0 AND answered_count AND answered_count BETWEEN 0 AND question_count)
  ),
  -- Pada tahap ini satu attempt per pelaksanaan; pengulangan dengan izin admin
  -- belum tersedia dan tidak dapat dibuat dengan memuat ulang halaman.
  CONSTRAINT exam_attempt_one_per_run_identity UNIQUE (run_id, participant_identity_id),
  FOREIGN KEY (run_id, exam_test_id, period_id, kind)
    REFERENCES exam_schedule_runs (id, exam_test_id, period_id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (run_id, student_id)
    REFERENCES exam_schedule_participants (run_id, student_id) ON DELETE RESTRICT,
  FOREIGN KEY (participant_identity_id, student_id, period_id)
    REFERENCES participant_identities (id, student_id, period_id) ON DELETE RESTRICT
);
CREATE INDEX exam_attempts_identity_idx ON exam_attempts (participant_identity_id, started_at DESC, id DESC);
CREATE INDEX exam_attempts_due_idx ON exam_attempts (deadline, id) WHERE completed_at IS NULL;
CREATE INDEX exam_attempts_test_idx ON exam_attempts (exam_test_id, run_id, id);

CREATE TABLE exam_attempt_questions (
  attempt_id bigint NOT NULL REFERENCES exam_attempts(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 1000),
  snapshot_id bigint NOT NULL REFERENCES exam_question_snapshots(id) ON DELETE RESTRICT,
  -- Urutan tampilan adalah permutasi A–E asli; jawaban selalu menyimpan
  -- identitas asli agar acak pilihan tidak mengubah kunci penilaian.
  option_order text NOT NULL CHECK (
    option_order ~ '^[ABCDE]{5}$' AND position('A' IN option_order) > 0
    AND position('B' IN option_order) > 0 AND position('C' IN option_order) > 0
    AND position('D' IN option_order) > 0 AND position('E' IN option_order) > 0
  ),
  answer text CHECK (answer IN ('A','B','C','D','E')),
  answer_revision bigint NOT NULL DEFAULT 0 CHECK (answer_revision >= 0),
  answered_at timestamptz,
  PRIMARY KEY (attempt_id, position),
  UNIQUE (attempt_id, snapshot_id),
  CONSTRAINT exam_attempt_answer_time_check CHECK (answered_at IS NULL OR isfinite(answered_at))
);

-- Jawaban boleh berubah selama pengerjaan, tetapi soal, posisi, urutan dan
-- pemiliknya tidak boleh ditukar oleh operasi aplikasi yang keliru.
CREATE FUNCTION reject_exam_attempt_structure_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.attempt_id, OLD.position, OLD.snapshot_id, OLD.option_order)
       IS DISTINCT FROM ROW(NEW.attempt_id, NEW.position, NEW.snapshot_id, NEW.option_order) THEN
    RAISE EXCEPTION 'Susunan snapshot pengerjaan tidak dapat diubah' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER exam_attempt_question_structure_immutable
  BEFORE UPDATE OF attempt_id, position, snapshot_id, option_order ON exam_attempt_questions
  FOR EACH ROW EXECUTE FUNCTION reject_exam_attempt_structure_update();

-- Gambar adalah bagian dari snapshot. Versi yang sudah dipakai tidak boleh
-- ditambah atau dihapus; versi yang belum dipakai tetap dapat dibersihkan.
CREATE FUNCTION reject_used_exam_snapshot_image_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot_key bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN snapshot_key := OLD.snapshot_id; ELSE snapshot_key := NEW.snapshot_id; END IF;
  PERFORM id FROM exam_question_snapshots WHERE id=snapshot_key FOR UPDATE;
  IF EXISTS (SELECT 1 FROM exam_attempt_questions WHERE snapshot_id=snapshot_key) THEN
    RAISE EXCEPTION 'Gambar snapshot yang sudah dipakai tidak dapat diubah' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER exam_question_snapshot_images_used_immutable
  BEFORE INSERT OR DELETE ON exam_question_snapshot_images
  FOR EACH ROW EXECUTE FUNCTION reject_used_exam_snapshot_image_change();

-- Pembatas tebakan token terpisah dari pembatas login. Tidak ada kode token
-- mentah atau hash kode yang tersimpan pada bucket ini.
CREATE TABLE exam_start_token_attempts (
  participant_identity_id bigint PRIMARY KEY REFERENCES participant_identities(id) ON DELETE CASCADE,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  locked_until timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX exam_start_token_attempts_age_idx ON exam_start_token_attempts (last_attempt_at);
CREATE TABLE exam_start_token_global_limit (
  id smallint PRIMARY KEY CHECK (id = 1),
  window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 61)
);
INSERT INTO exam_start_token_global_limit(id) VALUES(1);
