-- test-bootstrap: schema
ALTER TABLE artikli ADD COLUMN IF NOT EXISTS povratna_embalaza boolean NOT NULL DEFAULT false;
ALTER TABLE artikli ADD COLUMN IF NOT EXISTS vrsta_embalaze text;
ALTER TABLE artikli ADD COLUMN IF NOT EXISTS depozitna_vrednost numeric(12,2);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artikli_vrsta_embalaze_check') THEN
    ALTER TABLE artikli ADD CONSTRAINT artikli_vrsta_embalaze_check
      CHECK (vrsta_embalaze IS NULL OR vrsta_embalaze IN ('steklenica','zaboj','keg','balon','drugo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artikli_depozitna_vrednost_check') THEN
    ALTER TABLE artikli ADD CONSTRAINT artikli_depozitna_vrednost_check
      CHECK (depozitna_vrednost IS NULL OR depozitna_vrednost >= 0);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS embalazni_prometi (
 id serial PRIMARY KEY, enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
 artikel_id integer NOT NULL REFERENCES artikli(id) ON DELETE RESTRICT,
 dobavitelj_id uuid REFERENCES counterparties(id) ON DELETE RESTRICT,
 kolicina numeric(12,4) NOT NULL CHECK (kolicina <> 0),
 depozitna_vrednost numeric(12,2), prejemnica_postavka_id integer,
 vrsta text NOT NULL DEFAULT 'prejem' CHECK (vrsta IN ('prejem','vracilo')),
 opomba text, datum timestamptz NOT NULL DEFAULT now(), actor_snapshot text,
 CONSTRAINT embalazni_prometi_receipt_line_unique UNIQUE (prejemnica_postavka_id)
);
CREATE INDEX IF NOT EXISTS embalazni_prometi_scope_idx ON embalazni_prometi(enota_id, artikel_id, dobavitelj_id);