-- Napitnina, vnesena na zaključnem pregledu javnega QR naročila.
-- Ostane ločena od prodajnega zneska in postavk.
ALTER TABLE narocila
  ADD COLUMN IF NOT EXISTS znesek_napitnina numeric(10, 2) NOT NULL DEFAULT 0;