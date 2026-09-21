ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS happy_hour_cena_mala NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS happy_hour_cena_druzinska NUMERIC(10, 2);

ALTER TABLE artikli
  DROP CONSTRAINT IF EXISTS artikli_happy_hour_cena_mala_nonnegative_check;
ALTER TABLE artikli
  ADD CONSTRAINT artikli_happy_hour_cena_mala_nonnegative_check
  CHECK (happy_hour_cena_mala IS NULL OR happy_hour_cena_mala >= 0);

ALTER TABLE artikli
  DROP CONSTRAINT IF EXISTS artikli_happy_hour_cena_druzinska_nonnegative_check;
ALTER TABLE artikli
  ADD CONSTRAINT artikli_happy_hour_cena_druzinska_nonnegative_check
  CHECK (happy_hour_cena_druzinska IS NULL OR happy_hour_cena_druzinska >= 0);