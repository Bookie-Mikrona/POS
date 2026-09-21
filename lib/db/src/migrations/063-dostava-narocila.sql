-- Dostava v telefonskih naročilih.
-- Cena je revizijski snapshot; za obračun se uporablja izključno postavka v postavke.
-- Idempotentno za razvojni in testni predkorak.

ALTER TABLE narocila
  ADD COLUMN IF NOT EXISTS nacin_izpolnitve text NOT NULL DEFAULT 'prevzem',
  ADD COLUMN IF NOT EXISTS narocnik_id integer,
  ADD COLUMN IF NOT EXISTS dostava_ulica text,
  ADD COLUMN IF NOT EXISTS dostava_hisna_stevilka text,
  ADD COLUMN IF NOT EXISTS dostava_vhod text,
  ADD COLUMN IF NOT EXISTS dostava_nadstropje text,
  ADD COLUMN IF NOT EXISTS dostava_naselje_naziv text,
  ADD COLUMN IF NOT EXISTS dostava_naselje_id integer,
  ADD COLUMN IF NOT EXISTS dostava_navodilo text,
  ADD COLUMN IF NOT EXISTS dostava_cena numeric(10, 2),
  ADD COLUMN IF NOT EXISTS dostava_cas_min integer,
  ADD COLUMN IF NOT EXISTS predvidena_dostava timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'narocila_nacin_izpolnitve_check' AND conrelid = 'narocila'::regclass
  ) THEN
    ALTER TABLE narocila
      ADD CONSTRAINT narocila_nacin_izpolnitve_check
      CHECK (nacin_izpolnitve IN ('prevzem', 'dostava'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'narocila_dostava_cena_check' AND conrelid = 'narocila'::regclass
  ) THEN
    ALTER TABLE narocila
      ADD CONSTRAINT narocila_dostava_cena_check
      CHECK (dostava_cena IS NULL OR dostava_cena >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'narocila_dostava_cas_min_check' AND conrelid = 'narocila'::regclass
  ) THEN
    ALTER TABLE narocila
      ADD CONSTRAINT narocila_dostava_cas_min_check
      CHECK (dostava_cas_min IS NULL OR dostava_cas_min >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'narocila_narocnik_id_fkey' AND conrelid = 'narocila'::regclass
  ) THEN
    ALTER TABLE narocila
      ADD CONSTRAINT narocila_narocnik_id_fkey
      FOREIGN KEY (narocnik_id) REFERENCES narocniki(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'narocila_dostava_naselje_id_fkey' AND conrelid = 'narocila'::regclass
  ) THEN
    ALTER TABLE narocila
      ADD CONSTRAINT narocila_dostava_naselje_id_fkey
      FOREIGN KEY (dostava_naselje_id) REFERENCES naselja(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_narocila_enota_dostava_odprta
  ON narocila (enota_id, predvidena_dostava)
  WHERE nacin_izpolnitve = 'dostava' AND status = 'odprto';

CREATE INDEX IF NOT EXISTS ix_narocila_narocnik_id
  ON narocila (narocnik_id);