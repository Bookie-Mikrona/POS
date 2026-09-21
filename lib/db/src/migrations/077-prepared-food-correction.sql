ALTER TABLE prepared_food_daily_ledgers
  ADD COLUMN IF NOT EXISTS correction_quantity numeric(14,4) NOT NULL DEFAULT 0;