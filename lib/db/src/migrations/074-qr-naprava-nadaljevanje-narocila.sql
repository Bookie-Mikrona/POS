-- Javni QR meni: isti brskalnik lahko k svojemu odprtemu naročilu doda novo košarico.
-- Ne gre za POS napravo; identifikator je naključni UUID, ustvarjen v javnem meniju.
ALTER TABLE narocila
  ADD COLUMN IF NOT EXISTS qr_naprava_id text;

-- Gost ima lahko na isti mizi hkrati natanko eno odprto QR naročilo iz iste naprave.
-- Delni indeks ne vpliva na osebje, stare QR zapise brez identifikatorja ali zaključena naročila.
CREATE UNIQUE INDEX IF NOT EXISTS ux_narocila_qr_naprava_odprto
  ON narocila (enota_id, miza_id, qr_naprava_id)
  WHERE vir = 'qr_gost'
    AND status = 'odprto'
    AND qr_naprava_id IS NOT NULL;