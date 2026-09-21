ALTER TABLE z_porocila
  ADD COLUMN IF NOT EXISTS znesek_napitnina numeric(14,2) NOT NULL DEFAULT 0;