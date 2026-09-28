-- test-bootstrap: schema
-- Snapshot packaging status onto a POS order line; backfill only on first column creation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'postavke'
      AND column_name = 'je_embalaza'
  ) THEN
    ALTER TABLE postavke
      ADD COLUMN je_embalaza boolean NOT NULL DEFAULT false;

    UPDATE postavke AS child
    SET je_embalaza = true
    FROM postavke AS parent,
      narocila AS order_row,
      artikli AS parent_article,
      artikli AS child_article,
      kategorije AS category
    WHERE child.parent_postavka_id = parent.id
      AND child.narocilo_id = parent.narocilo_id
      AND order_row.id = parent.narocilo_id
      AND parent_article.id = parent.artikel_id
      AND child_article.id = child.artikel_id
      AND category.id = child_article.kategorija_id
      AND parent.to_go = true
      AND child.davek = parent.davek
      AND parent_article.to_go_artikli::jsonb @> jsonb_build_array(child.artikel_id)
      AND lower(category.ime) = 'embalaža';
  END IF;
END;
$$;