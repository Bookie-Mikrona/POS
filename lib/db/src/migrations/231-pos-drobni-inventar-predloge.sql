-- test-bootstrap: schema
ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS drobni_inventar_predloga_kljuc text;

CREATE UNIQUE INDEX IF NOT EXISTS artikli_enota_drobni_inventar_predloga_unique
  ON artikli (enota_id, drobni_inventar_predloga_kljuc)
  WHERE drobni_inventar_predloga_kljuc IS NOT NULL;