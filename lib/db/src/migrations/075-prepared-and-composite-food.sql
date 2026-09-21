-- Pripravljene in sestavljene jedi. Vse izjave so varne za ponovno izvajanje,
-- ker se ta migracija uporablja tudi pri API testih na že obstoječi bazi.
ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS meal_type text NOT NULL DEFAULT 'ala_carte';
ALTER TABLE artikli
  DROP CONSTRAINT IF EXISTS artikli_meal_type_check;
ALTER TABLE artikli
  ADD CONSTRAINT artikli_meal_type_check
  CHECK (meal_type IN ('ala_carte', 'prepared', 'composite'));

ALTER TABLE postavke
  ADD COLUMN IF NOT EXISTS meal_type text NOT NULL DEFAULT 'ala_carte';
ALTER TABLE postavke
  ADD COLUMN IF NOT EXISTS availability_requirements jsonb;
ALTER TABLE postavke
  DROP CONSTRAINT IF EXISTS postavke_meal_type_check;
ALTER TABLE postavke
  ADD CONSTRAINT postavke_meal_type_check
  CHECK (meal_type IN ('ala_carte', 'prepared', 'composite'));

-- All creation paths (staff, QR and integrations) share postavke inserts.
-- The trigger guarantees the historical snapshot even if a caller omits it.
CREATE OR REPLACE FUNCTION snapshot_postavka_meal_type() RETURNS trigger AS $$
BEGIN
  IF NEW.artikel_id IS NOT NULL
     AND (NEW.meal_type IS NULL OR NEW.meal_type = 'ala_carte') THEN
    SELECT meal_type INTO NEW.meal_type FROM artikli WHERE id = NEW.artikel_id;
  END IF;
  NEW.meal_type := COALESCE(NEW.meal_type, 'ala_carte');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_snapshot_postavka_meal_type ON postavke;
CREATE TRIGGER trg_snapshot_postavka_meal_type
  BEFORE INSERT ON postavke
  FOR EACH ROW EXECUTE FUNCTION snapshot_postavka_meal_type();

ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS waste_account_id uuid
  REFERENCES accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS prepared_food_stocks (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  artikel_id integer NOT NULL REFERENCES artikli(id) ON DELETE RESTRICT,
  year integer NOT NULL,
  opening_quantity numeric(14,4) NOT NULL DEFAULT 0 CHECK (opening_quantity >= 0),
  opening_cost_per_portion numeric(14,6) NOT NULL DEFAULT 0 CHECK (opening_cost_per_portion >= 0),
  frozen_quantity numeric(14,4) NOT NULL DEFAULT 0 CHECK (frozen_quantity >= 0),
  frozen_cost_per_portion numeric(14,6) NOT NULL DEFAULT 0 CHECK (frozen_cost_per_portion >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_prepared_food_stocks_enota_article_year UNIQUE (enota_id, artikel_id, year)
);

CREATE TABLE IF NOT EXISTS prepared_food_daily_ledgers (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  artikel_id integer NOT NULL REFERENCES artikli(id) ON DELETE RESTRICT,
  thawed_quantity numeric(14,4) NOT NULL DEFAULT 0 CHECK (thawed_quantity >= 0),
  prepared_quantity numeric(14,4) NOT NULL DEFAULT 0 CHECK (prepared_quantity >= 0),
  sold_quantity numeric(14,4) NOT NULL DEFAULT 0 CHECK (sold_quantity >= 0),
  frozen_at_end_quantity numeric(14,4) NOT NULL DEFAULT 0 CHECK (frozen_at_end_quantity >= 0),
  waste_quantity numeric(14,4) NOT NULL DEFAULT 0 CHECK (waste_quantity >= 0),
  thawed_cost_per_portion numeric(14,6),
  prepared_cost_per_portion numeric(14,6),
  waste_value numeric(14,4),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_prepared_food_daily_ledger UNIQUE (enota_id, business_date, artikel_id)
);
CREATE INDEX IF NOT EXISTS ix_prepared_food_daily_ledger_date
  ON prepared_food_daily_ledgers (enota_id, business_date);