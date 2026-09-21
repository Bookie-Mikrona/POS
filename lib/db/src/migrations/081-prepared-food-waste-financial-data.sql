-- Finančni podatki so zgodovinski posnetek zapisnikove vrstice.
-- Varno za ponovno izvajanje: uporablja IF NOT EXISTS in deterministični UPDATE.
ALTER TABLE prepared_food_waste_record_lines
  ADD COLUMN IF NOT EXISTS cost_per_unit numeric(14,6) NOT NULL DEFAULT 0;
ALTER TABLE prepared_food_waste_record_lines
  ADD COLUMN IF NOT EXISTS total_value numeric(14,4) NOT NULL DEFAULT 0;

UPDATE prepared_food_waste_record_lines AS line
SET
  cost_per_unit = CASE
    WHEN ledger.waste_quantity > 0
      THEN COALESCE(ledger.waste_value, 0) / ledger.waste_quantity
    ELSE 0
  END,
  total_value = line.quantity * CASE
    WHEN ledger.waste_quantity > 0
      THEN COALESCE(ledger.waste_value, 0) / ledger.waste_quantity
    ELSE 0
  END
FROM prepared_food_daily_ledgers AS ledger
WHERE ledger.enota_id = (
    SELECT record.enota_id
    FROM prepared_food_waste_records AS record
    WHERE record.id = line.record_id
  )
  AND ledger.business_date = line.business_date
  AND ledger.artikel_id = line.artikel_id;