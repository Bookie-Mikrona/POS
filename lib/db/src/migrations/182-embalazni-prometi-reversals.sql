-- test-bootstrap: audit
ALTER TABLE embalazni_prometi
  ADD COLUMN IF NOT EXISTS reversal_of_id integer;

ALTER TABLE embalazni_prometi
  DROP CONSTRAINT IF EXISTS embalazni_prometi_receipt_line_unique;
DROP INDEX IF EXISTS embalazni_prometi_receipt_line_unique;
CREATE UNIQUE INDEX embalazni_prometi_receipt_line_unique
  ON embalazni_prometi(prejemnica_postavka_id)
  WHERE prejemnica_postavka_id IS NOT NULL AND reversal_of_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'embalazni_prometi_reversal_of_id_fkey'
  ) THEN
    ALTER TABLE embalazni_prometi
      ADD CONSTRAINT embalazni_prometi_reversal_of_id_fkey
      FOREIGN KEY (reversal_of_id) REFERENCES embalazni_prometi(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS embalazni_prometi_reversal_of_id_unique
  ON embalazni_prometi(reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

COMMENT ON COLUMN embalazni_prometi.reversal_of_id IS
  'Append-only reversal link; each packaging movement may be reversed at most once.';