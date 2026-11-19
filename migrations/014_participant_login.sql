-- Login peserta terpisah dari admin. Migrasi tidak membuat akun, sandi, atau
-- token ujian dan tidak mengubah kunci enkripsi yang sudah ada.
CREATE TABLE participant_sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  participant_identity_id bigint NOT NULL UNIQUE REFERENCES participant_identities(id) ON DELETE RESTRICT,
  placement_id bigint NOT NULL REFERENCES student_class_placements(id) ON DELETE RESTRICT,
  username_snapshot text NOT NULL,
  identity_revision timestamptz NOT NULL,
  password_revision timestamptz NOT NULL,
  password_hash_digest bytea NOT NULL CHECK (octet_length(password_hash_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX participant_sessions_expiry_idx ON participant_sessions (expires_at);

-- Bucket per kombinasi periode/username memakai digest; tidak menyimpan sandi,
-- token sesi, atau input mentah. Baris lama dibersihkan secara oportunistik.
CREATE TABLE participant_login_attempts (
  bucket_hash bytea PRIMARY KEY CHECK (octet_length(bucket_hash) = 32),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  locked_until timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX participant_login_attempts_age_idx ON participant_login_attempts (last_attempt_at);

-- Batas keseluruhan melindungi pekerjaan scrypt dari percobaan dengan banyak
-- username berbeda. Ini bukan pembatas per IP dan bukan pengganti proteksi jaringan.
CREATE TABLE participant_login_global_limit (
  id smallint PRIMARY KEY CHECK (id = 1),
  window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 181)
);
INSERT INTO participant_login_global_limit (id) VALUES (1);
