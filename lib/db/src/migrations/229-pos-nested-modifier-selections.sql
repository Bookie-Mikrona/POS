-- test-bootstrap: schema
-- Enonivojske podizbire POS modifikatorjev ohranijo izvor in posnetek izbir.
ALTER TABLE postavke
  ADD COLUMN IF NOT EXISTS izvorni_modifikator_id integer,
  ADD COLUMN IF NOT EXISTS izvorni_normativ_id integer,
  ADD COLUMN IF NOT EXISTS izvorni_normativ_faktor numeric(12, 6),
  ADD COLUMN IF NOT EXISTS pod_izbire jsonb;

CREATE INDEX IF NOT EXISTS ix_postavke_izvorni_normativ
  ON postavke (izvorni_normativ_id)
  WHERE izvorni_normativ_id IS NOT NULL;