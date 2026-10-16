-- test-bootstrap: schema
-- Family pizzas need their own explicitly editable prepared dough article.
ALTER TABLE pizza_dough_settings
  ADD COLUMN IF NOT EXISTS family_dough_article_id integer;

-- Preserve current order behavior until a unit chooses a dedicated family dough.
UPDATE pizza_dough_settings
SET family_dough_article_id = normal_dough_article_id
WHERE family_dough_article_id IS NULL;

ALTER TABLE pizza_dough_settings
  ALTER COLUMN family_dough_article_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pizza_dough_settings_family_article_unit_fk'
      AND conrelid = 'pizza_dough_settings'::regclass
  ) THEN
    ALTER TABLE pizza_dough_settings
      ADD CONSTRAINT pizza_dough_settings_family_article_unit_fk
      FOREIGN KEY (family_dough_article_id, enota_id)
      REFERENCES artikli(id, enota_id) ON DELETE RESTRICT;
  END IF;
END $$;
