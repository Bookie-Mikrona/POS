-- test-bootstrap: schema
BEGIN;

ALTER TABLE postavke
  ADD COLUMN IF NOT EXISTS course_name_snapshot text;

ALTER TABLE kds_nalogi
  ADD COLUMN IF NOT EXISTS course_name_snapshot text;

COMMIT;