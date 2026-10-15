-- test-bootstrap: schema
-- Testni bootstrap ne ponavlja poslovnega backfilla iz migracije 256.
-- Obstoječe vrednosti in nastavitve skupin ostanejo nespremenjene.
ALTER TABLE modifikatorji
  ADD COLUMN IF NOT EXISTS privzet boolean NOT NULL DEFAULT false;
