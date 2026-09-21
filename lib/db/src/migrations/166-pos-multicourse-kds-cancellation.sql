BEGIN;

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

ALTER TABLE kds_nalogi
  ALTER COLUMN postavka_id DROP NOT NULL;
ALTER TABLE kds_nalogi
  DROP CONSTRAINT IF EXISTS kds_nalogi_postavka_id_fkey;
ALTER TABLE kds_nalogi
  ADD CONSTRAINT kds_nalogi_postavka_id_fkey
  FOREIGN KEY (postavka_id) REFERENCES postavke(id) ON DELETE SET NULL;

COMMIT;