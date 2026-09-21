-- Zapisniki o oddaji kala in sled oddanih količin. Migracija je varna za
-- ponovno izvajanje, ker jo uporabljajo tudi API testi.
ALTER TABLE prepared_food_daily_ledgers
  ADD COLUMN IF NOT EXISTS waste_delivered_quantity numeric(14,4) NOT NULL DEFAULT 0;
ALTER TABLE prepared_food_daily_ledgers
  DROP CONSTRAINT IF EXISTS prepared_food_daily_delivered_quantity_check;
ALTER TABLE prepared_food_daily_ledgers
  ADD CONSTRAINT prepared_food_daily_delivered_quantity_check
  CHECK (
    waste_delivered_quantity >= 0
    AND waste_delivered_quantity <= waste_quantity
  );

CREATE TABLE IF NOT EXISTS prepared_food_waste_records (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  company_name text NOT NULL,
  business_unit_name text NOT NULL,
  record_date date NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  waste_observed_at timestamptz NOT NULL,
  disposal_reason text NOT NULL,
  signature_person text NOT NULL,
  signature_manager text NOT NULL,
  status text NOT NULL DEFAULT 'osnutek',
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prepared_food_waste_records_status_check CHECK (status IN ('osnutek', 'potrjen')),
  CONSTRAINT prepared_food_waste_records_period_check CHECK (period_from <= period_to)
);
CREATE INDEX IF NOT EXISTS ix_prepared_food_waste_records_enota_period
  ON prepared_food_waste_records (enota_id, period_from, period_to);

CREATE TABLE IF NOT EXISTS prepared_food_waste_record_lines (
  id serial PRIMARY KEY,
  record_id integer NOT NULL REFERENCES prepared_food_waste_records(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  artikel_id integer NOT NULL REFERENCES artikli(id) ON DELETE RESTRICT,
  article_name text NOT NULL,
  unit_of_measure text NOT NULL,
  quantity numeric(14,4) NOT NULL CHECK (quantity > 0),
  CONSTRAINT ux_prepared_food_waste_record_line UNIQUE (record_id, business_date, artikel_id)
);
CREATE INDEX IF NOT EXISTS ix_prepared_food_waste_record_lines_record
  ON prepared_food_waste_record_lines (record_id);