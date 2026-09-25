-- test-bootstrap: schema
-- Optional drained-yield defaults and receipt-line snapshots.
BEGIN;

ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS bruto_teza_g numeric(12, 3),
  ADD COLUMN IF NOT EXISTS neto_teza_g numeric(12, 3),
  ADD COLUMN IF NOT EXISTS neto_delez_odst numeric(7, 4);

ALTER TABLE prejemnice_postavke
  ADD COLUMN IF NOT EXISTS bruto_teza_g numeric(12, 3),
  ADD COLUMN IF NOT EXISTS neto_teza_g numeric(12, 3),
  ADD COLUMN IF NOT EXISTS neto_delez_odst numeric(7, 4);

COMMIT;