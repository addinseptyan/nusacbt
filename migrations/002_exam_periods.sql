CREATE TABLE exam_periods (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  start_date date NOT NULL,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  CHECK (end_date IS NULL OR (end_date >= start_date AND end_date <= DATE '9999-12-31'))
);

CREATE INDEX exam_periods_start_date_idx ON exam_periods (start_date DESC, id DESC);
