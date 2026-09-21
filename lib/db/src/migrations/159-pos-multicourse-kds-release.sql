BEGIN;

ALTER TABLE postavke
  ADD COLUMN IF NOT EXISTS course_number smallint,
  ADD COLUMN IF NOT EXISTS course_sequence smallint,
  ADD COLUMN IF NOT EXISTS pairing_group_id text;

ALTER TABLE kds_nalogi
  ADD COLUMN IF NOT EXISTS course_number integer,
  ADD COLUMN IF NOT EXISTS course_sequence integer,
  ADD COLUMN IF NOT EXISTS pairing_group_id text;

-- Existing rows are all actionable.  New multicourse tickets can additionally
-- use the held state until an explicit fire command promotes them to aktivno.
-- Keep the later cancellation values in this replayed constraint as well:
-- post-merge setup reruns historical migrations against the current schema.
ALTER TABLE kds_nalogi
  DROP CONSTRAINT IF EXISTS kds_nalogi_stanje_check;
ALTER TABLE kds_nalogi
  ADD CONSTRAINT kds_nalogi_stanje_check
  CHECK (stanje IN ('zadrzano', 'aktivno', 'bumped', 'ack', 'preklicano'));

ALTER TABLE kds_dogodki
  DROP CONSTRAINT IF EXISTS kds_dogodki_tip_check;
ALTER TABLE kds_dogodki
  ADD CONSTRAINT kds_dogodki_tip_check
  CHECK (tip IN ('materializiran', 'sproscen', 'bump', 'ack', 'preklic'));

CREATE INDEX IF NOT EXISTS ix_kds_nalogi_narocilo_course
  ON kds_nalogi (narocilo_id, course_number, stanje);

COMMIT;