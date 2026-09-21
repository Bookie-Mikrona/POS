-- test-bootstrap: integrity

ALTER TABLE artikel_dobavitelj
  DROP CONSTRAINT IF EXISTS ck_ad_kljuc;

ALTER TABLE artikel_dobavitelj
  ADD CONSTRAINT ck_ad_kljuc CHECK (
    sifra_dobavitelja IS NOT NULL
    OR gtin IS NOT NULL
    OR naziv_norm IS NOT NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_naziv_only
  ON artikel_dobavitelj (enota_id, dobavitelj_id, naziv_norm)
  WHERE sifra_dobavitelja IS NULL
    AND gtin IS NULL
    AND naziv_norm IS NOT NULL;