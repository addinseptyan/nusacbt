-- Peran admin/operator, izin granular, profil & status akun, serta jejak tindakan akun panel.

CREATE TABLE admin_roles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug varchar(48) NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{1,47}$'),
  name varchar(60) NOT NULL,
  description varchar(200) NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_roles_name_check CHECK (
    char_length(btrim(name, E' \t\n\r')) BETWEEN 1 AND 60
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT admin_roles_description_check CHECK (
    char_length(description) <= 200
    AND description !~ '[[:cntrl:]]'
  )
);

CREATE UNIQUE INDEX admin_roles_name_ci_idx
  ON admin_roles (lower(btrim(name, E' \t\n\r')));

CREATE TABLE admin_role_permissions (
  role_id bigint NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission_key varchar(64) NOT NULL CHECK (
    permission_key IN (
      'topics.manage',
      'questions.manage',
      'questions.import',
      'questions.export',
      'academic_years.manage',
      'periods.manage',
      'classes.manage',
      'students.manage',
      'participant_accounts.manage',
      'participant_passwords.manage',
      'participant_cards.print',
      'exams.manage',
      'exam_controls.manage',
      'monitoring.view',
      'grading_overrides.manage',
      'tokens.manage',
      'reports.view',
      'tools.manage',
      'app_settings.manage',
      'users.manage',
      'roles.manage'
    )
  ),
  PRIMARY KEY (role_id, permission_key)
);

ALTER TABLE admin_users
  ADD COLUMN full_name varchar(100) NOT NULL DEFAULT '',
  ADD COLUMN is_superuser boolean NOT NULL DEFAULT false,
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN role_id bigint REFERENCES admin_roles(id) ON DELETE RESTRICT,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_login_at timestamptz;

ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_full_name_check CHECK (
    char_length(full_name) <= 100
    AND full_name !~ '[[:cntrl:]]'
  );

-- Akun admin yang sudah ada sebelum 026 dipertahankan sebagai superadmin aktif.
UPDATE admin_users
SET is_superuser = true,
    is_active = true,
    full_name = CASE WHEN full_name = '' THEN username ELSE full_name END,
    updated_at = now();

ALTER TABLE admin_roles
  ADD COLUMN updated_by bigint REFERENCES admin_users(id) ON DELETE SET NULL;

INSERT INTO admin_roles (slug, name, description, is_system)
VALUES
  ('operator_ujian', 'Operator Ujian', 'Mengelola sesi/jadwal tes, token, akun peserta, monitoring, dan cetak kartu tanpa sandi.', true),
  ('pembuat_soal', 'Pembuat Soal', 'Mengelola topik/mata pelajaran, bank soal, serta impor dan ekspor soal Word.', true),
  ('pengawas', 'Pengawas / Proktor', 'Memantau jalannya ujian, mengelola token, melihat rekap, dan mencetak kartu tanpa sandi.', true);

INSERT INTO admin_role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM admin_roles r
JOIN (VALUES
  ('operator_ujian', 'participant_accounts.manage'),
  ('operator_ujian', 'participant_cards.print'),
  ('operator_ujian', 'exams.manage'),
  ('operator_ujian', 'monitoring.view'),
  ('operator_ujian', 'tokens.manage'),
  ('pembuat_soal', 'topics.manage'),
  ('pembuat_soal', 'questions.manage'),
  ('pembuat_soal', 'questions.import'),
  ('pembuat_soal', 'questions.export'),
  ('pengawas', 'participant_cards.print'),
  ('pengawas', 'monitoring.view'),
  ('pengawas', 'tokens.manage'),
  ('pengawas', 'reports.view')
) AS p(slug, permission_key) ON p.slug = r.slug;

CREATE TABLE admin_user_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_user_id bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  target_username_snapshot varchar(64) NOT NULL,
  actor_id bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  actor_username_snapshot varchar(64) NOT NULL,
  event varchar(32) NOT NULL CHECK (
    event IN ('create', 'update', 'reset_password', 'activate', 'deactivate', 'unlock')
  ),
  detail text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_user_audit_occurred_idx ON admin_user_audit (id DESC);
