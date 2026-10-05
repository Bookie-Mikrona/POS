-- test-bootstrap: schema
CREATE TABLE IF NOT EXISTS pos_booking_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id uuid CHECK (period_id IS NULL),
  entry_date date NOT NULL,
  document_date date,
  tax_date date,
  receipt_date date,
  description text NOT NULL,
  reference text,
  status journal_entry_status NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
  source_type text NOT NULL DEFAULT 'document',
  created_by text NOT NULL,
  posted_at timestamptz CHECK (posted_at IS NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_booking_drafts_company_date
  ON pos_booking_drafts(company_id, entry_date);
CREATE UNIQUE INDEX IF NOT EXISTS pos_booking_drafts_company_reference
  ON pos_booking_drafts(company_id, reference);
CREATE TABLE IF NOT EXISTS pos_booking_draft_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES pos_booking_drafts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  side journal_entry_side NOT NULL,
  amount numeric(18,2) NOT NULL,
  description text,
  sequence integer NOT NULL DEFAULT 0,
  partner_id uuid REFERENCES counterparties(id) ON DELETE SET NULL,
  cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  vat_code_id uuid REFERENCES vat_code(id),
  vat_amount numeric(18,2) DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pos_booking_draft_lines_entry ON pos_booking_draft_lines(entry_id);
