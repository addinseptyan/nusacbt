-- Penanda idempoten mencegah impor yang sama pada satu pratinjau tersimpan dua kali
-- ketika tombol diklik ulang atau respons jaringan terputus.
CREATE TABLE question_import_batches (
  operation_id uuid PRIMARY KEY,
  topic_id bigint REFERENCES question_topics(id) ON DELETE SET NULL,
  admin_id bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  question_count integer NOT NULL CHECK (question_count BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
