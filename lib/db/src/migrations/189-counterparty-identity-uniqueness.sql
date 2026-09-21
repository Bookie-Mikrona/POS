-- test-bootstrap: integrity
-- Poslovni partner znotraj podjetja ne sme biti dvakrat ustvarjen zaradi
-- sočasnih OCR uvozov. Normalizacija pokrije presledke in oblikovne znake.

CREATE UNIQUE INDEX IF NOT EXISTS counterparties_company_tax_id_uq
  ON counterparties (
    company_id,
    (regexp_replace(coalesce(tax_id, ''), '\D', '', 'g'))
  )
  WHERE regexp_replace(coalesce(tax_id, ''), '\D', '', 'g') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS counterparties_company_vat_id_uq
  ON counterparties (
    company_id,
    (upper(regexp_replace(coalesce(id_za_ddv, ''), '\s', '', 'g')))
  )
  WHERE upper(regexp_replace(coalesce(id_za_ddv, ''), '\s', '', 'g')) <> '';