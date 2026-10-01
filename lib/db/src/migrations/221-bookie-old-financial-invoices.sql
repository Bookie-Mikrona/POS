-- test-bootstrap: schema
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS historical_net numeric(18,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS historical_vat numeric(18,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS historical_gross numeric(18,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS historical_reference text;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_source_type_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_source_type_check
  -- Replays must preserve the later reviewed-FX source type.
  CHECK (source_type IN ('manual', 'pos-sync', 'pos-contract-summary', 'bookie-old', 'ai-document-fx'));
CREATE UNIQUE INDEX IF NOT EXISTS invoices_historical_reference_unique
  ON invoices(company_id, historical_reference);