-- Kebijakan nilai kini global per kategori pelaksanaan, bukan per rancangan.
-- Keputusan admin: ketiga kategori langsung terbuka, termasuk pengerjaan lama
-- yang telah selesai. Blur di browser hanya penyamaran visual, bukan keamanan.
-- Tabel 020 disimpan sebagai arsip; nilainya tidak lagi dipakai aplikasi baru.
-- Pengerjaan, jawaban, sesi, kunci dan kebijakan 020 tidak diubah migrasi ini.
CREATE TABLE exam_score_category_visibility (
  kind text PRIMARY KEY CHECK (kind IN ('regular', 'makeup', 'remedial')),
  visible_to_participants boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(updated_at)),
  updated_by bigint REFERENCES admin_users(id) ON DELETE SET NULL
);
INSERT INTO exam_score_category_visibility(kind) VALUES ('regular'), ('makeup'), ('remedial');
