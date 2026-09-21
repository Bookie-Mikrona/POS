-- test-bootstrap: schema

ALTER TABLE prejemnice
  ADD COLUMN IF NOT EXISTS placilni_model text,
  ADD COLUMN IF NOT EXISTS placilni_namen text;