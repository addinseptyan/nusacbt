-- Token administrasi hanya untuk persiapan. Belum ada login/pengerjaan peserta.
-- Simpan hash acak, bukan kode plaintext. Durasi dihitung dengan jam database.
-- Saat modul pengerjaan dibuat, pemeriksaan token dan pembuatan attempt HARUS
-- atomik: sinkronkan dengan pembuatan/pencabutan token, periksa waktu server dan
-- jadwal, prioritaskan token khusus yang aktif, dan periksa ulang sebelum commit.
-- Token valid saat mulai saja; jangan memutus attempt ketika token kedaluwarsa.
CREATE TABLE exam_access_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('global', 'test')),
  exam_test_id bigint REFERENCES exam_tests(id) ON DELETE SET NULL,
  test_name_snapshot text,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 1440),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  created_by_admin_id bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  revoked_by_admin_id bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT exam_access_tokens_scope_link_check CHECK (
    (scope = 'global' AND exam_test_id IS NULL AND test_name_snapshot IS NULL)
    OR (scope = 'test' AND test_name_snapshot IS NOT NULL AND char_length(test_name_snapshot) BETWEEN 1 AND 100)
  ),
  CONSTRAINT exam_access_tokens_expiry_check CHECK (isfinite(issued_at) AND isfinite(expires_at) AND expires_at = issued_at + duration_minutes * interval '1 minute'),
  CONSTRAINT exam_access_tokens_revoked_check CHECK (
    (revoked_at IS NULL AND revoked_reason IS NULL AND revoked_by_admin_id IS NULL)
    OR (revoked_at IS NOT NULL AND isfinite(revoked_at) AND revoked_reason IS NOT NULL AND revoked_reason IN ('manual', 'replaced'))
  )
);

-- Hanya satu token yang belum ditutup per cakupan. Token kedaluwarsa tetap
-- menempati slot sampai token berikut dibuat atau ditutup; server memeriksa
-- expires_at sebelum menganggapnya aktif.
CREATE UNIQUE INDEX exam_access_tokens_one_global ON exam_access_tokens ((true))
  WHERE scope = 'global' AND revoked_at IS NULL;
CREATE UNIQUE INDEX exam_access_tokens_one_per_test ON exam_access_tokens (exam_test_id)
  WHERE scope = 'test' AND exam_test_id IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX exam_access_tokens_issued_idx ON exam_access_tokens (issued_at DESC, id DESC);

-- Jejak idempotensi juga menjadi pagar untuk permintaan yang hasilnya tidak
-- pasti. Pagar tidak menyimpan kode; jangan hapus jejak ini sementara request
-- lama masih mungkin tiba. Penghapusan token langsung tidak mengizinkan replay.
CREATE TABLE exam_token_issue_operations (
  operation_id uuid PRIMARY KEY,
  result text NOT NULL CHECK (result IN ('issued', 'cancelled')),
  token_id bigint UNIQUE REFERENCES exam_access_tokens(id) ON DELETE SET NULL,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(completed_at)),
  CONSTRAINT exam_token_issue_operations_link_check CHECK (result = 'issued' OR token_id IS NULL)
);

-- SET NULL hanya berlaku untuk token ber-scope test; scope tidak pernah berubah
-- menjadi global. Setelah tes dihapus, token tersebut tidak cocok dengan tes
-- mana pun, dan metadata riwayat tetap tersimpan.
