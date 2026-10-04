-- test-bootstrap: schema
-- Durable outbox; intentionally no backfill of existing articles.
CREATE TABLE IF NOT EXISTS pos_allergen_research_jobs (
  id serial PRIMARY KEY,
  artikel_id integer NOT NULL UNIQUE,
  enota_id integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (artikel_id, enota_id) REFERENCES artikli(id, enota_id) ON DELETE CASCADE
);
CREATE OR REPLACE FUNCTION enqueue_new_ingredient_allergen_research()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.nabavni_artikel AND NOT NEW.drobni_inventar AND NOT NEW.povratna_embalaza
     AND NEW.aktiven AND NEW.meal_type <> 'prepared' THEN
    INSERT INTO pos_allergen_research_jobs (artikel_id, enota_id)
    VALUES (NEW.id, NEW.enota_id) ON CONFLICT (artikel_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS new_ingredient_allergen_research ON artikli;
CREATE TRIGGER new_ingredient_allergen_research AFTER INSERT ON artikli
FOR EACH ROW EXECUTE FUNCTION enqueue_new_ingredient_allergen_research();