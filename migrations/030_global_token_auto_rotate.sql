-- Pengaturan rotasi otomatis token global sesuai durasi token yang dipilih.
CREATE TABLE global_token_auto_rotate (
  id integer PRIMARY KEY CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  duration_minutes integer NOT NULL DEFAULT 15
    CHECK (duration_minutes IN (5, 15, 30, 60, 120, 360, 1440)),
  updated_by_admin_id bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO global_token_auto_rotate (id, enabled, duration_minutes)
VALUES (1, false, 15);
