-- 034: finančni podatki POS prejemnice in nastavitve nabavnih kontov.
-- Vse nove vrednosti so nullable ali imajo varen privzeti podatek, zato
-- obstoječe materialne prejemnice in zalogovni tok ostanejo nespremenjeni.

ALTER TABLE prejemnice
  ADD COLUMN IF NOT EXISTS valuta text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS datum_zapadlosti date,
  ADD COLUMN IF NOT EXISTS ddv_osnova numeric(14,2),
  ADD COLUMN IF NOT EXISTS ddv_znesek numeric(14,2);

ALTER TABLE prejemnice_postavke
  ADD COLUMN IF NOT EXISTS ddv_stopnja numeric(5,2),
  ADD COLUMN IF NOT EXISTS ddv_osnova numeric(14,2),
  ADD COLUMN IF NOT EXISTS ddv_znesek numeric(14,2),
  ADD COLUMN IF NOT EXISTS vat_code_id uuid,
  ADD COLUMN IF NOT EXISTS vrstica_tip text NOT NULL DEFAULT 'zaloga';

ALTER TABLE prejemnice_postavke
  ADD CONSTRAINT prejemnice_postavke_vrstica_tip_check
  CHECK (vrstica_tip IN ('zaloga', 'strosek')) NOT VALID;

ALTER TABLE prejemnice_postavke
  ADD CONSTRAINT prejemnice_postavke_vat_code_fk
  FOREIGN KEY (vat_code_id) REFERENCES vat_code(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS prejemnice_odvisni_stroski (
  id serial PRIMARY KEY,
  prejemnica_id integer NOT NULL REFERENCES prejemnice(id) ON DELETE CASCADE,
  naziv text NOT NULL,
  znesek numeric(14,2) NOT NULL,
  ddv_stopnja numeric(5,2),
  obravnava text NOT NULL DEFAULT 'zaloga',
  CONSTRAINT prejemnice_odvisni_stroski_obravnava_check
    CHECK (obravnava IN ('zaloga', 'strosek'))
);
CREATE INDEX IF NOT EXISTS ix_prejemnice_odvisni_stroski_prejemnica
  ON prejemnice_odvisni_stroski(prejemnica_id);

ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS nabava_obracun_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS input_vat_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS input_vat_22_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS input_vat_95_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS input_vat_5_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS other_costs_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN pos_booking_settings.nabava_obracun_account_id IS
  'Prehodni konto obračuna nabave (npr. 109); brez vpliva do naslednjega koraka knjiženja.';