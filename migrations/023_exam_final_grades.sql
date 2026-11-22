-- Nilai lama tidak diubah dan tidak otomatis ditetapkan. Metode yang belum
-- dikonfigurasi adalah nilai tertinggi; hasil baru dihitung dari pengerjaan
-- selesai milik identitas yang sama; nilai bulat pada audit bukan sumber hitung.
CREATE UNIQUE INDEX participant_identities_id_period_unique
  ON participant_identities (id, period_id);
CREATE INDEX exam_attempt_final_grade_idx
  ON exam_attempts (exam_test_id, participant_identity_id, id)
  INCLUDE (period_id, completed_at, correct_count, question_count, kind);

CREATE TABLE exam_final_grade_settings (
  exam_test_id bigint PRIMARY KEY REFERENCES exam_tests(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('highest', 'average')),
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(updated_at)),
  updated_by bigint REFERENCES admin_users(id) ON DELETE SET NULL
);

-- Baris tidak ada berarti belum ditetapkan dan revisi nol. Membuka kembali
-- mempertahankan baris serta menaikkan revisi agar formulir lama tidak berlaku.
CREATE TABLE exam_final_grade_state (
  exam_test_id bigint NOT NULL,
  participant_identity_id bigint NOT NULL,
  period_id bigint NOT NULL,
  finalized_at timestamptz,
  finalized_by bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(updated_at)),
  updated_by bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  PRIMARY KEY (exam_test_id, participant_identity_id),
  FOREIGN KEY (exam_test_id, period_id) REFERENCES exam_tests(id, period_id) ON DELETE RESTRICT,
  FOREIGN KEY (participant_identity_id, period_id) REFERENCES participant_identities(id, period_id) ON DELETE RESTRICT,
  CHECK (finalized_at IS NULL OR isfinite(finalized_at)),
  CHECK (finalized_by IS NULL OR finalized_at IS NOT NULL)
);
CREATE INDEX exam_final_grade_state_identity_idx
  ON exam_final_grade_state (participant_identity_id, exam_test_id) WHERE finalized_at IS NOT NULL;

-- Jejak tindakan sekaligus pagar idempoten ketika respons admin hilang. Untuk
-- aksi yang dibatalkan tidak ada perubahan nilai/status. Snapshot nilai pada
-- tindakan bukan sumber perhitungan. Tidak menyimpan token atau jawaban.
-- ID target sengaja tanpa FK agar jejak/pagar tetap ada walau tes draf dihapus;
-- operasi aplikasi memeriksa target, periode, dan hak akses sebelum mengubah.
CREATE TABLE exam_final_grade_operations (
  operation_id uuid PRIMARY KEY,
  exam_test_id bigint NOT NULL CHECK (exam_test_id > 0),
  participant_identity_id bigint CHECK (participant_identity_id > 0),
  action text NOT NULL CHECK (action IN ('method', 'finalize', 'reopen')),
  result text NOT NULL CHECK (result IN ('applied', 'cancelled')),
  old_value text,
  new_value text,
  revision bigint,
  revoked_permissions integer,
  recorded_method text CHECK (recorded_method IN ('highest', 'average')),
  recorded_hundredths integer CHECK (recorded_hundredths BETWEEN 0 AND 10000),
  recorded_attempt_count integer CHECK (recorded_attempt_count > 0),
  recorded_attempt_ids bigint[],
  actor_id bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  CONSTRAINT exam_final_operation_target_check CHECK (
    (action = 'method' AND participant_identity_id IS NULL)
    OR (action IN ('finalize', 'reopen') AND participant_identity_id IS NOT NULL)
  ),
  CONSTRAINT exam_final_operation_result_check CHECK (
    (result = 'cancelled' AND old_value IS NULL AND new_value IS NULL AND revision IS NULL AND revoked_permissions IS NULL
      AND recorded_method IS NULL AND recorded_hundredths IS NULL AND recorded_attempt_count IS NULL AND recorded_attempt_ids IS NULL AND actor_id IS NULL)
    OR (result = 'applied' AND revision IS NOT NULL AND revision > 0 AND old_value IS NOT NULL AND new_value IS NOT NULL AND (
      (action = 'method' AND old_value IN ('highest', 'average') AND new_value IN ('highest', 'average')
        AND old_value <> new_value AND revoked_permissions IS NULL
        AND recorded_method IS NULL AND recorded_hundredths IS NULL AND recorded_attempt_count IS NULL AND recorded_attempt_ids IS NULL)
      OR (action IN ('finalize', 'reopen') AND recorded_method IS NOT NULL AND recorded_hundredths IS NOT NULL AND recorded_attempt_count IS NOT NULL
        AND recorded_attempt_ids IS NOT NULL AND cardinality(recorded_attempt_ids) = recorded_attempt_count AND array_position(recorded_attempt_ids, NULL) IS NULL
        AND revoked_permissions IS NOT NULL AND (
          (action = 'finalize' AND old_value = 'open' AND new_value = 'final' AND revoked_permissions >= 0)
          OR (action = 'reopen' AND old_value = 'final' AND new_value = 'open' AND revoked_permissions = 0)
        ))
    ))
  )
);
CREATE INDEX exam_final_operations_test_idx ON exam_final_grade_operations (exam_test_id, created_at DESC, operation_id);
CREATE INDEX exam_final_operations_identity_idx ON exam_final_grade_operations (participant_identity_id, exam_test_id) WHERE participant_identity_id IS NOT NULL;
