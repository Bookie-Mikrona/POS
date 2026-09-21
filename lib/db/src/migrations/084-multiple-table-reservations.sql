-- Multiple, auditable reservations per table.  Legacy mize columns stay only
-- for compatibility with installations that have not deployed this release.
CREATE TABLE IF NOT EXISTS rezervacije_miz (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  miza_id integer NOT NULL REFERENCES mize(id) ON DELETE CASCADE,
  narocnik_id integer REFERENCES narocniki(id) ON DELETE SET NULL,
  stranka_ime text NOT NULL,
  telefon text NOT NULL,
  opomba text,
  zacetek timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'aktivna'
    CHECK (status IN ('aktivna', 'porabljena', 'sprostena', 'potekla')),
  narocilo_id integer,
  porabljena timestamptz,
  sproscena timestamptz,
  potekla timestamptz,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  posodobljeno timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE narocila ADD COLUMN IF NOT EXISTS rezervacija_id integer
  REFERENCES rezervacije_miz(id) ON DELETE SET NULL;
ALTER TABLE rezervacije_miz DROP CONSTRAINT IF EXISTS fk_rezervacije_miz_narocilo;
ALTER TABLE rezervacije_miz ADD CONSTRAINT fk_rezervacije_miz_narocilo
  FOREIGN KEY (narocilo_id) REFERENCES narocila(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_rezervacije_miz_enota_miza_zacetek
  ON rezervacije_miz(enota_id, miza_id, zacetek);
CREATE INDEX IF NOT EXISTS ix_rezervacije_miz_aktivne
  ON rezervacije_miz(miza_id, status, zacetek);
CREATE INDEX IF NOT EXISTS ix_rezervacije_miz_narocilo ON rezervacije_miz(narocilo_id);
CREATE INDEX IF NOT EXISTS ix_narocila_rezervacija_id ON narocila(rezervacija_id);

CREATE OR REPLACE FUNCTION set_rezervacije_miz_posodobljeno()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.posodobljeno = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_rezervacije_miz_posodobljeno ON rezervacije_miz;
CREATE TRIGGER trg_rezervacije_miz_posodobljeno
BEFORE UPDATE ON rezervacije_miz FOR EACH ROW EXECUTE FUNCTION set_rezervacije_miz_posodobljeno();

-- 082/083 stored an expiry/deadline rather than an arrival.  Its best safe
-- interpretation is the recorded instant; do not fabricate missing rows.
INSERT INTO rezervacije_miz (enota_id, miza_id, narocnik_id, stranka_ime, telefon, opomba, zacetek, status)
SELECT m.enota_id, m.id, m.rezervacija_narocnik_id, m.rezervacija_stranka_ime,
       m.rezervacija_telefon, m.rezervacija_opomba, m.rezervacija_velja_do, 'aktivna'
FROM mize m
WHERE m.status = 'rezervirana'
  AND m.rezervacija_stranka_ime IS NOT NULL AND btrim(m.rezervacija_stranka_ime) <> ''
  AND m.rezervacija_telefon IS NOT NULL AND btrim(m.rezervacija_telefon) <> ''
  AND m.rezervacija_velja_do IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM rezervacije_miz r
    WHERE r.miza_id = m.id AND r.zacetek = m.rezervacija_velja_do
      AND r.status = 'aktivna'
  );