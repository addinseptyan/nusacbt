CREATE TABLE database_backup_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  action varchar(16) NOT NULL CHECK (action IN ('backup', 'restore')),
  actor_id bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  actor_username_snapshot varchar(64) NOT NULL CHECK (char_length(actor_username_snapshot) BETWEEN 1 AND 64),
  archive_filename varchar(160) NOT NULL CHECK (char_length(archive_filename) BETWEEN 1 AND 160),
  archive_sha256 varchar(64) NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version varchar(64) NOT NULL CHECK (char_length(schema_version) BETWEEN 1 AND 64),
  table_count integer NOT NULL CHECK (table_count > 0),
  row_count integer NOT NULL CHECK (row_count >= 0),
  blob_count integer NOT NULL CHECK (blob_count >= 0),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  detail text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 500),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX database_backup_audit_occurred_idx ON database_backup_audit (id DESC);
