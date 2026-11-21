-- Tidak ada baris berarti nilai tersembunyi. Kebijakan adalah per rancangan
-- tes dan berlaku untuk semua pelaksanaannya, termasuk pengerjaan yang sudah
-- selesai. Hanya nilai satu pengerjaan yang boleh ditampilkan; kunci jawaban
-- dan nilai akhir agregat tidak dibuka oleh pengaturan ini.
CREATE TABLE exam_score_visibility (
  exam_test_id bigint PRIMARY KEY REFERENCES exam_tests(id) ON DELETE CASCADE,
  visible_to_participants boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(updated_at)),
  updated_by bigint REFERENCES admin_users(id) ON DELETE SET NULL
);
