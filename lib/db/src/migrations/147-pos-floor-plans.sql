-- Canonical versioned room floor plans. Legacy mize.pos_x/pos_y remain supported.
CREATE TABLE IF NOT EXISTS tlorisi (
  id serial PRIMARY KEY,
  prostor_id integer NOT NULL UNIQUE REFERENCES prostori(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 0,
  sirina integer NOT NULL DEFAULT 1200,
  visina integer NOT NULL DEFAULT 800,
  mreza integer NOT NULL DEFAULT 20,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  posodobljeno timestamptz NOT NULL DEFAULT now(),
  CHECK (version >= 0 AND sirina BETWEEN 100 AND 10000 AND visina BETWEEN 100 AND 10000 AND mreza BETWEEN 1 AND 500)
);

CREATE TABLE IF NOT EXISTS tloris_postavke (
  id text PRIMARY KEY,
  tloris_id integer NOT NULL REFERENCES tlorisi(id) ON DELETE CASCADE,
  vrsta text NOT NULL CHECK (vrsta IN ('table', 'wall', 'door', 'opening', 'label', 'zone', 'decoration')),
  miza_id integer REFERENCES mize(id) ON DELETE RESTRICT,
  x integer NOT NULL, y integer NOT NULL,
  sirina integer NOT NULL, visina integer NOT NULL,
  rotacija integer NOT NULL DEFAULT 0, z_index integer NOT NULL DEFAULT 0,
  zaklenjena boolean NOT NULL DEFAULT false, vidna boolean NOT NULL DEFAULT true,
  slog jsonb NOT NULL DEFAULT '{}'::jsonb, podatki jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (sirina BETWEEN 1 AND 10000 AND visina BETWEEN 1 AND 10000),
  CHECK (x BETWEEN -10000 AND 20000 AND y BETWEEN -10000 AND 20000)
);
CREATE INDEX IF NOT EXISTS ix_tloris_postavke_tloris ON tloris_postavke(tloris_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tloris_postavke_miza ON tloris_postavke(miza_id) WHERE miza_id IS NOT NULL;

ALTER TABLE mize ADD COLUMN IF NOT EXISTS tloris_sirina integer;
ALTER TABLE mize ADD COLUMN IF NOT EXISTS tloris_visina integer;
ALTER TABLE mize ADD COLUMN IF NOT EXISTS tloris_rotacija integer;

-- Create documents and table items for operational legacy positions.
INSERT INTO tlorisi (prostor_id)
SELECT DISTINCT prostor_id FROM mize WHERE prostor_id IS NOT NULL
ON CONFLICT (prostor_id) DO NOTHING;
INSERT INTO tloris_postavke (id, tloris_id, vrsta, miza_id, x, y, sirina, visina, rotacija, slog, podatki)
SELECT 'legacy-table-' || m.id, t.id, 'table', m.id, m.pos_x, m.pos_y,
  COALESCE(m.tloris_sirina, CASE WHEN m.oblika = 'kvadrat' THEN 72 WHEN m.oblika = 'okrogla' THEN 72 WHEN m.oblika = 'pravokotnik_v' THEN 56 ELSE 96 END),
  COALESCE(m.tloris_visina, CASE WHEN m.oblika = 'kvadrat' THEN 72 WHEN m.oblika = 'okrogla' THEN 72 WHEN m.oblika = 'pravokotnik_v' THEN 96 ELSE 56 END),
  COALESCE(m.tloris_rotacija, 0), '{}'::jsonb, jsonb_build_object('oblika', COALESCE(m.oblika, 'pravokotnik_h'))
FROM mize m JOIN tlorisi t ON t.prostor_id = m.prostor_id
WHERE m.pos_x IS NOT NULL AND m.pos_y IS NOT NULL AND m.arhivirana = false
ON CONFLICT DO NOTHING;