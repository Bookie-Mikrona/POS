-- Ločena interna evidenca ostankov s krožnikov.
-- Namenoma ni vezana na artikle, normative, naročila, zaloge ali ERP.
CREATE TABLE IF NOT EXISTS plate_waste_daily_entries (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  quantity_kg numeric(14,3) NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_plate_waste_daily_entries_enota_date UNIQUE (enota_id, business_date),
  CONSTRAINT plate_waste_daily_entries_quantity_check CHECK (quantity_kg >= 0)
);
CREATE INDEX IF NOT EXISTS ix_plate_waste_daily_entries_enota_date
  ON plate_waste_daily_entries (enota_id, business_date);

CREATE TABLE IF NOT EXISTS plate_waste_handovers (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  handover_date date NOT NULL,
  entry_type text NOT NULL DEFAULT 'oddaja',
  quantity_kg numeric(14,3) NOT NULL,
  collector_name text NOT NULL,
  manifest_number text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  correction_of_id integer REFERENCES plate_waste_handovers(id) ON DELETE RESTRICT,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plate_waste_handovers_entry_type_check CHECK (entry_type IN ('oddaja', 'popravek')),
  CONSTRAINT plate_waste_handovers_quantity_check CHECK (
    (entry_type = 'oddaja' AND quantity_kg > 0)
    OR (entry_type = 'popravek' AND quantity_kg <> 0)
  )
);
CREATE INDEX IF NOT EXISTS ix_plate_waste_handovers_enota_date
  ON plate_waste_handovers (enota_id, handover_date);