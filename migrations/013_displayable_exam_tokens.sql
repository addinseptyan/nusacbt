-- Migrasi 012 tidak diubah. Token lama tetap punya hash dan metadata, tetapi
-- kode lama tidak dapat dipulihkan. Token baru berupa enam angka dan salinan
-- AES-GCM dienkripsi dengan kunci luar database. token_hash untuk format baru
-- adalah HMAC berkunci, bukan SHA-256 enam angka yang mudah ditebak offline.
ALTER TABLE exam_access_tokens
  ADD COLUMN code_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN code_nonce bytea,
  ADD COLUMN code_ciphertext bytea,
  ADD COLUMN code_tag bytea,
  ADD CONSTRAINT exam_access_tokens_code_version_check CHECK (code_version IN (1, 2)),
  ADD CONSTRAINT exam_access_tokens_code_storage_check CHECK (
    (code_version = 1 AND code_nonce IS NULL AND code_ciphertext IS NULL AND code_tag IS NULL)
    OR (code_version = 2 AND code_nonce IS NOT NULL AND octet_length(code_nonce) = 12
       AND code_ciphertext IS NOT NULL AND octet_length(code_ciphertext) = 6
       AND code_tag IS NOT NULL AND octet_length(code_tag) = 16)
  ),
  ADD CONSTRAINT exam_access_tokens_new_duration_check CHECK (
    code_version = 1 OR duration_minutes IN (5, 15, 30, 60, 120, 360, 1440)
  );

-- Ruang enam angka hanya satu juta kemungkinan. Jangan menghabiskannya dengan
-- mewajibkan keunikan seluruh riwayat selamanya; kode pada slot yang belum
-- ditutup tetap unik antar-cakupan. Server juga menghindari pengulangan terbaru.
ALTER TABLE exam_access_tokens DROP CONSTRAINT exam_access_tokens_token_hash_key;
CREATE UNIQUE INDEX exam_access_tokens_open_hash_unique ON exam_access_tokens (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX exam_access_tokens_hash_history_idx ON exam_access_tokens (token_hash, issued_at DESC);

-- Kunci baru dibind pada database saat token 6 angka pertama dibuat. Penggantian
-- kunci mendadak atau penghapusan binding ketika ciphertext masih ada ditolak.
CREATE TABLE exam_token_key_binding (
  id smallint PRIMARY KEY CHECK (id = 1),
  verifier bytea NOT NULL CHECK (octet_length(verifier) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at))
);
