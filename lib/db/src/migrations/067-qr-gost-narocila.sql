-- QR meni Faza 1b: javna naročila se označijo ločeno, alkohol pa čaka na osebje.
ALTER TABLE narocila
  ADD COLUMN IF NOT EXISTS vir text NOT NULL DEFAULT 'osebje';

ALTER TABLE postavke
  ADD COLUMN IF NOT EXISTS status_potrditve text NOT NULL DEFAULT 'ni_potrebno';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_narocila_vir'
  ) THEN
    ALTER TABLE narocila
      ADD CONSTRAINT ck_narocila_vir CHECK (vir IN ('osebje', 'qr_gost'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_postavke_status_potrditve'
  ) THEN
    ALTER TABLE postavke
      ADD CONSTRAINT ck_postavke_status_potrditve
      CHECK (status_potrditve IN ('ni_potrebno', 'caka_potrditev', 'potrjeno'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_postavke_status_potrditve
  ON postavke (status_potrditve);