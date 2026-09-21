-- Kadrovska evidenca POS izmen: potrjevanje, odmori, odsotnosti, poprave in audit.

ALTER TABLE izmene
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'osnutek',
  ADD COLUMN IF NOT EXISTS potrjeno_by text,
  ADD COLUMN IF NOT EXISTS potrjeno_at timestamptz,
  ADD COLUMN IF NOT EXISTS zavrnitev_razlog text;

ALTER TABLE izmene DROP CONSTRAINT IF EXISTS izmene_status_check;
ALTER TABLE izmene ADD CONSTRAINT izmene_status_check
  CHECK (status IN ('osnutek', 'v_potrditvi', 'potrjeno', 'zavrnjeno'));

CREATE TABLE IF NOT EXISTS odmori (
  id serial PRIMARY KEY,
  izmena_id integer NOT NULL REFERENCES izmene(id) ON DELETE CASCADE,
  vrsta text NOT NULL DEFAULT 'neplacan' CHECK (vrsta IN ('placan', 'neplacan')),
  zacetek timestamptz NOT NULL,
  konec timestamptz,
  opomba text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT odmori_valid_interval CHECK (konec IS NULL OR konec > zacetek)
);
CREATE INDEX IF NOT EXISTS odmori_izmena_zacetek_idx ON odmori(izmena_id, zacetek);

CREATE TABLE IF NOT EXISTS odsotnosti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  natakari_id integer NOT NULL REFERENCES natakari(id) ON DELETE RESTRICT,
  od date NOT NULL,
  "do" date NOT NULL,
  tip text NOT NULL CHECK (tip IN ('dopust', 'bolniska', 'druga_odsotnost')),
  opomba text,
  status text NOT NULL DEFAULT 'osnutek' CHECK (status IN ('osnutek', 'potrjeno', 'zavrnjeno')),
  created_by text NOT NULL,
  potrjeno_by text,
  potrjeno_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT odsotnosti_valid_interval CHECK ("do" >= od)
);
CREATE INDEX IF NOT EXISTS odsotnosti_enota_obdobje_idx ON odsotnosti(enota_id, od, "do");
CREATE INDEX IF NOT EXISTS odsotnosti_natakar_obdobje_idx ON odsotnosti(natakari_id, od, "do");

CREATE TABLE IF NOT EXISTS izmena_popravki (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  izmena_id integer NOT NULL REFERENCES izmene(id) ON DELETE RESTRICT,
  star_zacetek timestamptz NOT NULL,
  star_konec timestamptz,
  nov_zacetek timestamptz NOT NULL,
  nov_konec timestamptz,
  razlog text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT izmena_popravki_valid_interval CHECK (nov_konec IS NULL OR nov_konec > nov_zacetek)
);
CREATE INDEX IF NOT EXISTS izmena_popravki_izmena_created_idx ON izmena_popravki(izmena_id, created_at);

CREATE TABLE IF NOT EXISTS kadrovski_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  entiteta text NOT NULL,
  entiteta_id text NOT NULL,
  dejanje text NOT NULL,
  razlog text,
  actor_id text NOT NULL,
  pred jsonb,
  po jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kadrovski_audit_entity_idx ON kadrovski_audit(entiteta, entiteta_id, created_at);
CREATE INDEX IF NOT EXISTS kadrovski_audit_company_idx ON kadrovski_audit(company_id, created_at);