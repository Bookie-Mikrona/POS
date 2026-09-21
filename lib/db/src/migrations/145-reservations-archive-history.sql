-- Reservation records must remain readable after a table is removed from operations.
ALTER TABLE mize
  ADD COLUMN IF NOT EXISTS arhivirana boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS arhivirana_ob timestamptz;

ALTER TABLE rezervacije_miz
  ADD COLUMN IF NOT EXISTS miza_stevilka_snapshot integer,
  ADD COLUMN IF NOT EXISTS miza_ime_snapshot text,
  ADD COLUMN IF NOT EXISTS prostor_ime_snapshot text;

UPDATE rezervacije_miz r
SET miza_stevilka_snapshot = m.stevilka,
    miza_ime_snapshot = m.ime,
    prostor_ime_snapshot = p.ime
FROM mize m LEFT JOIN prostori p ON p.id = m.prostor_id
WHERE r.miza_id = m.id
  AND r.miza_stevilka_snapshot IS NULL;

CREATE TABLE IF NOT EXISTS rezervacije_miz_zgodovina (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL,
  rezervacija_id integer,
  miza_id integer NOT NULL,
  dogodek text NOT NULL CHECK (dogodek IN ('ustvarjena', 'posodobljena', 'preklicana', 'miza_arhivirana')),
  actor_clerk_user_id text,
  podatki jsonb NOT NULL DEFAULT '{}'::jsonb,
  ustvarjeno timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rezervacije_miz_zgodovina
  DROP CONSTRAINT IF EXISTS rezervacije_miz_zgodovina_enota_id_enote_id_fk;
ALTER TABLE rezervacije_miz_zgodovina
  DROP CONSTRAINT IF EXISTS rezervacije_miz_zgodovina_rezervacija_id_rezervacije_miz_id_fk;
CREATE INDEX IF NOT EXISTS ix_rezervacije_miz_zgodovina_rezervacija
  ON rezervacije_miz_zgodovina (rezervacija_id, ustvarjeno);
CREATE INDEX IF NOT EXISTS ix_rezervacije_miz_zgodovina_miza
  ON rezervacije_miz_zgodovina (enota_id, miza_id, ustvarjeno);

CREATE OR REPLACE FUNCTION prevent_rezervacije_miz_zgodovina_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- FK cascades are database housekeeping, not an application mutation.
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Reservation history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS trg_rezervacije_miz_zgodovina_append_only ON rezervacije_miz_zgodovina;
CREATE TRIGGER trg_rezervacije_miz_zgodovina_append_only
  BEFORE UPDATE OR DELETE ON rezervacije_miz_zgodovina
  FOR EACH ROW EXECUTE FUNCTION prevent_rezervacije_miz_zgodovina_mutation();
