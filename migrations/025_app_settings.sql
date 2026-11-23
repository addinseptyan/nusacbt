-- Pengaturan identitas aplikasi/sekolah, informasi peserta, logo, kop surat, dan palet warna.
CREATE TABLE app_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  app_name varchar(60) NOT NULL DEFAULT 'NusaCBT',
  app_description varchar(160) NOT NULL DEFAULT 'Platform ujian sekolah',
  school_name varchar(120) NOT NULL DEFAULT '',
  participant_info text NOT NULL DEFAULT '',
  color_palette varchar(24) NOT NULL DEFAULT 'emerald'
    CHECK (color_palette IN ('emerald', 'indigo', 'blue', 'violet', 'rose', 'amber')),
  logo_image bytea,
  logo_image_mime text,
  letterhead_image bytea,
  letterhead_image_mime text,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_settings_app_name_check CHECK (
    char_length(btrim(app_name, E' \t\n\r')) BETWEEN 1 AND 60
    AND app_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT app_settings_description_check CHECK (
    char_length(app_description) <= 160
    AND app_description !~ '[[:cntrl:]]'
  ),
  CONSTRAINT app_settings_school_name_check CHECK (
    char_length(school_name) <= 120
    AND school_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT app_settings_participant_info_check CHECK (
    char_length(participant_info) <= 2000
    AND translate(participant_info, E'\t\n\r', '') !~ '[[:cntrl:]]'
  ),
  CONSTRAINT app_settings_logo_image_check CHECK (
    (logo_image IS NULL AND logo_image_mime IS NULL)
    OR (
      logo_image IS NOT NULL
      AND logo_image_mime IS NOT NULL
      AND logo_image_mime IN ('image/png', 'image/jpeg')
      AND octet_length(logo_image) BETWEEN 1 AND 1048576
    )
  ),
  CONSTRAINT app_settings_letterhead_image_check CHECK (
    (letterhead_image IS NULL AND letterhead_image_mime IS NULL)
    OR (
      letterhead_image IS NOT NULL
      AND letterhead_image_mime IS NOT NULL
      AND letterhead_image_mime IN ('image/png', 'image/jpeg')
      AND octet_length(letterhead_image) BETWEEN 1 AND 2097152
    )
  )
);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
