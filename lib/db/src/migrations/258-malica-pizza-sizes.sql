-- test-bootstrap: schema
-- Persist pizza size variants in Malica assignments and daily offers.

ALTER TABLE malica_article_assignments
  ADD COLUMN IF NOT EXISTS velikost_pice text;
ALTER TABLE malica_daily_main_items
  ADD COLUMN IF NOT EXISTS velikost_pice text;

-- Existing pizza assignments and offers represented the regular pizza.
UPDATE malica_article_assignments AS assignment
SET velikost_pice = 'normalna'
FROM artikli AS article
WHERE article.id = assignment.artikel_id
  AND article.je_pica = true
  AND assignment.role = 'main'
  AND assignment.velikost_pice IS NULL;

UPDATE malica_daily_main_items AS main_item
SET velikost_pice = 'normalna'
FROM artikli AS article
WHERE article.id = main_item.artikel_id
  AND article.je_pica = true
  AND main_item.velikost_pice IS NULL;

ALTER TABLE malica_article_assignments
  DROP CONSTRAINT IF EXISTS malica_article_assignments_unit_article_uq;
ALTER TABLE malica_daily_main_items
  DROP CONSTRAINT IF EXISTS malica_daily_main_items_offer_article_uq;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_article_assignments_pizza_size_check') THEN
    ALTER TABLE malica_article_assignments
      ADD CONSTRAINT malica_article_assignments_pizza_size_check
      CHECK (velikost_pice IS NULL OR velikost_pice IN ('mala', 'normalna', 'druzinska')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_daily_main_items_pizza_size_check') THEN
    ALTER TABLE malica_daily_main_items
      ADD CONSTRAINT malica_daily_main_items_pizza_size_check
      CHECK (velikost_pice IS NULL OR velikost_pice IN ('mala', 'normalna', 'druzinska')) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS malica_article_assignments_unit_article_without_size_uq
  ON malica_article_assignments(enota_id, artikel_id)
  WHERE velikost_pice IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS malica_article_assignments_unit_article_size_uq
  ON malica_article_assignments(enota_id, artikel_id, velikost_pice)
  WHERE velikost_pice IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS malica_daily_main_items_offer_article_without_size_uq
  ON malica_daily_main_items(offer_id, artikel_id)
  WHERE velikost_pice IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS malica_daily_main_items_offer_article_size_uq
  ON malica_daily_main_items(offer_id, artikel_id, velikost_pice)
  WHERE velikost_pice IS NOT NULL;
