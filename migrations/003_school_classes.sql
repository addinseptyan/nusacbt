CREATE TABLE school_majors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX school_majors_name_ci_idx ON school_majors (lower(btrim(name)));

CREATE TABLE school_classes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  level text NOT NULL CHECK (level ~ '^[A-Z0-9]{1,12}$'),
  major_id bigint NOT NULL REFERENCES school_majors(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_classes_level_major_key UNIQUE (level, major_id)
);
