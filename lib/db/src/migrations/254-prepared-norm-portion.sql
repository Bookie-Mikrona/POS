-- test-bootstrap: schema
ALTER TABLE artikli ADD COLUMN IF NOT EXISTS prepared_norm_portion_quantity numeric(12,6);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artikli_prepared_norm_portion_positive' AND conrelid = 'artikli'::regclass) THEN
    ALTER TABLE artikli ADD CONSTRAINT artikli_prepared_norm_portion_positive
      CHECK (prepared_norm_portion_quantity IS NULL OR prepared_norm_portion_quantity > 0);
  END IF;
END $$;
