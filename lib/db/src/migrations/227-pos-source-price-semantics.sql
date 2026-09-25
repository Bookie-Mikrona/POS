-- test-bootstrap: schema
-- Preserve source price semantics for receipt lines during edits.
BEGIN;

ALTER TABLE prejemnice_postavke
  ADD COLUMN IF NOT EXISTS izv_cena_vrsta text,
  ADD COLUMN IF NOT EXISTS rabat_vkljucen_v_ceni boolean;

ALTER TABLE prejemnice_postavke
  DROP CONSTRAINT IF EXISTS prejemnice_postavke_izv_cena_vrsta_check;

ALTER TABLE prejemnice_postavke
  ADD CONSTRAINT prejemnice_postavke_izv_cena_vrsta_check
  CHECK (izv_cena_vrsta IS NULL OR izv_cena_vrsta IN ('neto', 'bruto'));

COMMIT;