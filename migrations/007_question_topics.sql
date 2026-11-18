-- Satu daftar fleksibel untuk nama mata pelajaran maupun topik.
-- Bank soal belum dibuat; modul soal berikutnya harus mereferensikan id dengan ON DELETE RESTRICT.
CREATE TABLE question_topics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_topics_name_check CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 100 AND name !~ '[[:cntrl:]]'
  )
);

CREATE UNIQUE INDEX question_topics_name_ci_idx ON question_topics (lower(name));
