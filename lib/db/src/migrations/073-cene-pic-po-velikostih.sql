-- Osnovna cena artikla ostane cena normalne pice. Dodatni velikosti sta
-- nullable, ker niso aktivne v vsaki poslovni enoti oziroma pri vsakem artiklu.
ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS cena_mala NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS cena_druzinska NUMERIC(10, 2);

ALTER TABLE artikli
  DROP CONSTRAINT IF EXISTS artikli_cena_mala_nonnegative_check;
ALTER TABLE artikli
  ADD CONSTRAINT artikli_cena_mala_nonnegative_check
  CHECK (cena_mala IS NULL OR cena_mala >= 0);

ALTER TABLE artikli
  DROP CONSTRAINT IF EXISTS artikli_cena_druzinska_nonnegative_check;
ALTER TABLE artikli
  ADD CONSTRAINT artikli_cena_druzinska_nonnegative_check
  CHECK (cena_druzinska IS NULL OR cena_druzinska >= 0);