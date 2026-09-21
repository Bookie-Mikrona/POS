-- Prihodkovni konti po POS kategorijah in nespremenljiv posnetek kategorije
-- na postavki. Preslikava ter posnetek namenoma nimata FK-ja na kategorije:
-- zgodovinski ponovni POS sync mora ostati enak tudi po brisanju kategorije.

CREATE TABLE IF NOT EXISTS pos_category_revenue_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id integer NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_category_revenue_accounts_company_category_uq
    UNIQUE (company_id, category_id)
);

ALTER TABLE postavke
  ADD COLUMN IF NOT EXISTS kategorija_id integer;

-- Za obstoječe vrstice je trenutna kategorija artikla najboljši razpoložljiv
-- zgodovinski približek. Od te migracije naprej jo trigger zamrzne ob insertu.
UPDATE postavke AS p
SET kategorija_id = a.kategorija_id
FROM artikli AS a
WHERE p.kategorija_id IS NULL
  AND p.artikel_id = a.id;

UPDATE postavke AS child
SET kategorija_id = parent.kategorija_id
FROM postavke AS parent
WHERE child.kategorija_id IS NULL
  AND child.parent_postavka_id = parent.id;

CREATE OR REPLACE FUNCTION set_postavka_kategorija_snapshot()
RETURNS trigger AS $$
BEGIN
  IF NEW.kategorija_id IS NULL AND NEW.artikel_id IS NOT NULL THEN
    SELECT kategorija_id
      INTO NEW.kategorija_id
      FROM artikli
      WHERE id = NEW.artikel_id;
  END IF;

  IF NEW.kategorija_id IS NULL AND NEW.parent_postavka_id IS NOT NULL THEN
    SELECT kategorija_id
      INTO NEW.kategorija_id
      FROM postavke
      WHERE id = NEW.parent_postavka_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS postavke_kategorija_snapshot_insert ON postavke;
CREATE TRIGGER postavke_kategorija_snapshot_insert
  BEFORE INSERT ON postavke
  FOR EACH ROW EXECUTE FUNCTION set_postavka_kategorija_snapshot();

CREATE OR REPLACE FUNCTION prevent_postavka_kategorija_snapshot_change()
RETURNS trigger AS $$
BEGIN
  IF NEW.kategorija_id IS DISTINCT FROM OLD.kategorija_id THEN
    RAISE EXCEPTION 'postavka kategorija snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS postavke_kategorija_snapshot_immutable ON postavke;
CREATE TRIGGER postavke_kategorija_snapshot_immutable
  BEFORE UPDATE ON postavke
  FOR EACH ROW EXECUTE FUNCTION prevent_postavka_kategorija_snapshot_change();