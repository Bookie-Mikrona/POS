-- test-bootstrap: schema
-- Additive development migration. Existing ledgers keep their original semantics.
ALTER TABLE artikli ADD COLUMN IF NOT EXISTS recipe_batch_pieces integer;
ALTER TABLE prepared_food_daily_ledgers ADD COLUMN IF NOT EXISTS preparation_batches jsonb;
ALTER TABLE prepared_food_daily_ledgers ADD COLUMN IF NOT EXISTS normative_batch_pieces integer;
ALTER TABLE prepared_food_daily_ledgers ADD COLUMN IF NOT EXISTS preparation_recipe_snapshot jsonb;