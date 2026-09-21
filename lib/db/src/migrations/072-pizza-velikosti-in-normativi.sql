-- Izbrana velikost mora ostati zgodovinsko vezana na naročilno vrstico.
ALTER TABLE postavke
  ADD COLUMN IF NOT EXISTS velikost_pice TEXT,
  ADD COLUMN IF NOT EXISTS normativ_faktor NUMERIC(12, 6) NOT NULL DEFAULT 1;

ALTER TABLE postavke
  DROP CONSTRAINT IF EXISTS postavke_velikost_pice_check;
ALTER TABLE postavke
  ADD CONSTRAINT postavke_velikost_pice_check
  CHECK (velikost_pice IS NULL OR velikost_pice IN ('mala', 'normalna', 'druzinska'));

ALTER TABLE postavke
  DROP CONSTRAINT IF EXISTS postavke_normativ_faktor_positive_check;
ALTER TABLE postavke
  ADD CONSTRAINT postavke_normativ_faktor_positive_check
  CHECK (normativ_faktor > 0);