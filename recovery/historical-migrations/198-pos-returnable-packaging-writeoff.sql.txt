-- test-bootstrap: schema
-- Dedicated, append-only write-off event for broken/non-returnable packaging.
ALTER TABLE embalazni_prometi
  ADD COLUMN IF NOT EXISTS odpis_razlog text;

ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS returnable_packaging_writeoff_account_id uuid
  REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE embalazni_prometi
  DROP CONSTRAINT IF EXISTS embalazni_prometi_vrsta_check;
ALTER TABLE embalazni_prometi
  DROP CONSTRAINT IF EXISTS embalazni_prometi_odpis_razlog_check;

ALTER TABLE embalazni_prometi
  ADD CONSTRAINT embalazni_prometi_vrsta_check
  CHECK (
    vrsta IN ('prejem', 'vracilo', 'odpis')
    AND (
      (vrsta = 'odpis' AND odpis_razlog IN ('razbitje', 'uniceno', 'nevracljivo'))
      OR (vrsta <> 'odpis' AND odpis_razlog IS NULL)
    )
  );

ALTER TABLE embalazni_prometi
  ADD CONSTRAINT embalazni_prometi_odpis_razlog_check
  CHECK (odpis_razlog IS NULL OR odpis_razlog IN ('razbitje', 'uniceno', 'nevracljivo'));

CREATE INDEX IF NOT EXISTS embalazni_prometi_writeoff_scope_idx
  ON embalazni_prometi(enota_id, artikel_id, dobavitelj_id, vrsta);

COMMENT ON COLUMN embalazni_prometi.odpis_razlog IS
  'Required constrained reason for odpis movements: razbitje, uniceno, or nevracljivo.';