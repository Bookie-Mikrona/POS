ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS contract_receivable_transit_account_id uuid
  REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual';
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS source_period text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_source_type_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_source_type_check
      CHECK (source_type IN ('manual', 'pos-sync', 'pos-contract-summary')) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pos_contract_invoice_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  receipt_id integer NOT NULL REFERENCES racuni(id) ON DELETE RESTRICT,
  daily_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  gross_amount numeric(18,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_contract_invoice_receipts_receipt_unique
  ON pos_contract_invoice_receipts(receipt_id);
CREATE UNIQUE INDEX IF NOT EXISTS pos_contract_invoice_receipts_invoice_receipt_unique
  ON pos_contract_invoice_receipts(invoice_id, receipt_id);
CREATE INDEX IF NOT EXISTS pos_contract_invoice_receipts_company_invoice_idx
  ON pos_contract_invoice_receipts(company_id, invoice_id);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_contract_summary_period_unique
  ON invoices(company_id, source_type, counterparty_id, source_period)
  WHERE source_period IS NOT NULL;