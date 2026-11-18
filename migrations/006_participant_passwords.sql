-- Sandi dikaitkan dengan identitas siswa/periode. Migrasi tidak membuat sandi.
-- Kunci enkripsi berada di file terpisah di luar database dan repository.
CREATE TABLE participant_password_key_binding (
  id smallint PRIMARY KEY CHECK (id = 1),
  verifier bytea NOT NULL CHECK (octet_length(verifier) = 32),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE participant_passwords (
  participant_identity_id bigint PRIMARY KEY REFERENCES participant_identities(id) ON DELETE RESTRICT,
  password_hash text NOT NULL CHECK (char_length(password_hash) BETWEEN 100 AND 512 AND password_hash LIKE 'scrypt$%'),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 12 AND 512),
  authentication_tag bytea NOT NULL CHECK (octet_length(authentication_tag) = 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Audit tidak menyimpan sandi, hash, ciphertext, kunci, atau sandi admin.
-- Belum merupakan log kebal-ubah bagi pengelola database.
CREATE TABLE participant_password_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_identity_id bigint NOT NULL REFERENCES participant_identities(id) ON DELETE RESTRICT,
  admin_id bigint NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  event text NOT NULL CHECK (event IN ('create_manual', 'create_auto', 'reset_manual', 'reset_auto', 'reveal')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX participant_password_audit_identity_idx
  ON participant_password_audit (participant_identity_id, occurred_at DESC, id DESC);
CREATE INDEX participant_password_audit_admin_idx ON participant_password_audit (admin_id);
