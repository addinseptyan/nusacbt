-- Riwayat pengerjaan lama tetap utuh. Sebelum migrasi, satu pasangan
-- pelaksanaan/identitas hanya memiliki satu attempt, sehingga indeks parsial
-- dapat dibuat tanpa mengubah baris atau jawaban yang sudah ada.
ALTER TABLE exam_attempts DROP CONSTRAINT exam_attempt_one_per_run_identity;
CREATE UNIQUE INDEX exam_attempt_one_active_per_run_identity
  ON exam_attempts (run_id, participant_identity_id) WHERE completed_at IS NULL;
CREATE UNIQUE INDEX exam_attempt_identity_reference_unique
  ON exam_attempts (id, run_id, participant_identity_id);
CREATE INDEX exam_attempt_run_identity_history_idx
  ON exam_attempts (run_id, participant_identity_id, id DESC);

-- Izin terikat pada satu pengerjaan yang selesai dan satu pelaksanaan serta
-- identitas. Izin yang dibatalkan tetap disimpan; hanya satu izin yang belum
-- digunakan dapat tersedia sekaligus. Pengerjaan baru dan pemakaian izin
-- disimpan dalam transaksi yang sama oleh layanan aplikasi.
CREATE TABLE exam_retake_permissions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id bigint NOT NULL,
  participant_identity_id bigint NOT NULL,
  previous_attempt_id bigint NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  granted_by bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoked_by bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  consumed_at timestamptz,
  consumed_attempt_id bigint UNIQUE,
  FOREIGN KEY (previous_attempt_id, run_id, participant_identity_id)
    REFERENCES exam_attempts (id, run_id, participant_identity_id) ON DELETE RESTRICT,
  FOREIGN KEY (consumed_attempt_id, run_id, participant_identity_id)
    REFERENCES exam_attempts (id, run_id, participant_identity_id) ON DELETE RESTRICT,
  CONSTRAINT exam_retake_permission_times_check CHECK (
    isfinite(granted_at)
    AND (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= granted_at))
    AND (consumed_at IS NULL OR (isfinite(consumed_at) AND consumed_at >= granted_at))
  ),
  CONSTRAINT exam_retake_permission_state_check CHECK (
    (revoked_at IS NULL OR consumed_at IS NULL)
    AND (revoked_by IS NULL OR revoked_at IS NOT NULL)
    AND ((consumed_at IS NULL AND consumed_attempt_id IS NULL)
      OR (consumed_at IS NOT NULL AND consumed_attempt_id IS NOT NULL AND consumed_attempt_id <> previous_attempt_id))
  )
);
CREATE UNIQUE INDEX exam_retake_one_pending_per_identity
  ON exam_retake_permissions (run_id, participant_identity_id)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;
CREATE UNIQUE INDEX exam_retake_one_valid_per_previous
  ON exam_retake_permissions (previous_attempt_id) WHERE revoked_at IS NULL;
CREATE INDEX exam_retake_previous_history_idx
  ON exam_retake_permissions (previous_attempt_id, id DESC);

-- Jejak idempotensi sekaligus pagar untuk tindakan admin yang responsnya
-- hilang. Pemeriksaan dapat mencatat 'cancelled' sebelum request terlambat
-- tiba, atau melaporkan izin yang sudah terbit/dicabut. Tidak menyimpan token.
CREATE UNIQUE INDEX exam_retake_permission_reference_unique
  ON exam_retake_permissions (id, previous_attempt_id);
CREATE TABLE exam_retake_operations (
  operation_id uuid PRIMARY KEY,
  attempt_id bigint NOT NULL REFERENCES exam_attempts(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('grant', 'revoke')),
  result text NOT NULL CHECK (result IN ('applied', 'cancelled')),
  permission_id bigint,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  FOREIGN KEY (permission_id, attempt_id)
    REFERENCES exam_retake_permissions (id, previous_attempt_id) ON DELETE RESTRICT,
  CONSTRAINT exam_retake_operation_result_check CHECK (
    (result='cancelled' AND permission_id IS NULL) OR (result='applied' AND permission_id IS NOT NULL)
  )
);
CREATE INDEX exam_retake_operations_attempt_idx ON exam_retake_operations (attempt_id);
