-- Opis za generiranje slik prodajnih artiklov.
-- Nullable zaradi združljivosti z obstoječimi artikli in varno ponovljiv.
ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS opis_slike TEXT;