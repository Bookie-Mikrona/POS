-- Trajno zabeleži storitev, uporabljeno za dostavno postavko.
-- Nastavitve enote se lahko kasneje spremenijo, odprta dostava pa mora ohraniti
-- izjemo To Go za prvotno storitev.

ALTER TABLE narocila
  ADD COLUMN IF NOT EXISTS dostava_storitev_id integer;