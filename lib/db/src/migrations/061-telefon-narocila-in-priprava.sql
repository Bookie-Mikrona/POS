-- Telefonska/prevzemna naročila in ocena časa priprave.
-- Razvojna migracija je idempotentna, zato jo lahko varno uporabi tudi testni predkorak.

ALTER TABLE narocila
  ADD COLUMN IF NOT EXISTS nacin text NOT NULL DEFAULT 'miza',
  ADD COLUMN IF NOT EXISTS stranka_ime text,
  ADD COLUMN IF NOT EXISTS stranka_telefon text,
  ADD COLUMN IF NOT EXISTS shranjeni_kupec_id integer,
  ADD COLUMN IF NOT EXISTS predviden_prevzem timestamptz,
  ADD COLUMN IF NOT EXISTS predviden_prevzem_rocen boolean NOT NULL DEFAULT false;

ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS cas_priprave_min integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'narocila_nacin_check' AND conrelid = 'narocila'::regclass
  ) THEN
    ALTER TABLE narocila
      ADD CONSTRAINT narocila_nacin_check CHECK (nacin IN ('miza', 'telefon'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'artikli_cas_priprave_min_check' AND conrelid = 'artikli'::regclass
  ) THEN
    ALTER TABLE artikli
      ADD CONSTRAINT artikli_cas_priprave_min_check CHECK (cas_priprave_min >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'narocila_shranjeni_kupec_id_fkey' AND conrelid = 'narocila'::regclass
  ) THEN
    ALTER TABLE narocila
      ADD CONSTRAINT narocila_shranjeni_kupec_id_fkey
      FOREIGN KEY (shranjeni_kupec_id) REFERENCES shranjeni_kupci(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_narocila_telefon_odprta
  ON narocila (enota_id, predviden_prevzem)
  WHERE nacin = 'telefon' AND status = 'odprto';