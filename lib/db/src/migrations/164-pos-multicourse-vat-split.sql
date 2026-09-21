ALTER TABLE multicourse_menus
  ADD COLUMN IF NOT EXISTS food_price_percent numeric(5,2) NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'multicourse_menus_food_price_percent_check'
  ) THEN
    ALTER TABLE multicourse_menus
      ADD CONSTRAINT multicourse_menus_food_price_percent_check
      CHECK (food_price_percent >= 0 AND food_price_percent <= 100);
  END IF;
END $$;