-- 054-artikli-vrsta-storitev-default.sql
--
-- Novi artikli so v splošnem prodajni artikli, zato je osnovni DB default
-- storitev. Obstoječih vrst ne spreminjamo. Nabavni/zalogovni tokovi pošiljajo
-- izrecno vrednost material.

ALTER TABLE artikli
  ALTER COLUMN vrsta_artikla SET DEFAULT 'storitev';