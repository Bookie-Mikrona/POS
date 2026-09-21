ALTER TABLE prepared_food_waste_records
  ADD COLUMN IF NOT EXISTS record_number integer;

WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY enota_id
      ORDER BY created_at, id
    )::integer AS record_number
  FROM prepared_food_waste_records
)
UPDATE prepared_food_waste_records AS records
SET record_number = numbered.record_number
FROM numbered
WHERE records.id = numbered.id
  AND records.record_number IS NULL;

ALTER TABLE prepared_food_waste_records
  ALTER COLUMN record_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_prepared_food_waste_records_enota_number
  ON prepared_food_waste_records (enota_id, record_number);