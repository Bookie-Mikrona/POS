-- test-bootstrap: schema
-- Supplier ordering terms (minimum order amount, lead time) per unit and
-- minimum package quantity per supplier mapping. All values are optional.

CREATE TABLE IF NOT EXISTS pos_supplier_terms (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  dobavitelj_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  min_znesek_narocila numeric(15,2),
  rok_dobave_dni integer,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_supplier_terms_unit_supplier_uq UNIQUE (enota_id, dobavitelj_id),
  CONSTRAINT pos_supplier_terms_min_znesek_check CHECK (min_znesek_narocila IS NULL OR min_znesek_narocila >= 0),
  CONSTRAINT pos_supplier_terms_rok_check CHECK (rok_dobave_dni IS NULL OR (rok_dobave_dni >= 0 AND rok_dobave_dni <= 365))
);

ALTER TABLE artikel_dobavitelj
  ADD COLUMN IF NOT EXISTS min_kolicina_pakiranj numeric(18,6);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artikel_dobavitelj_min_kolicina_check') THEN
    ALTER TABLE artikel_dobavitelj
      ADD CONSTRAINT artikel_dobavitelj_min_kolicina_check
      CHECK (min_kolicina_pakiranj IS NULL OR min_kolicina_pakiranj > 0);
  END IF;
END $$;
