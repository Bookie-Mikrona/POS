-- test-bootstrap: schema
-- Zgodovinska zapiranja so dokazilo Bookie Old, ne nova bančna plačila.
CREATE TABLE IF NOT EXISTS bookie_old_ar_settlements (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  source_line_id text NOT NULL,
  original_amount numeric(18,2) NOT NULL,
  closed_amount numeric(18,2) NOT NULL,
  remaining_amount numeric(18,2) NOT NULL,
  source_as_of date NOT NULL,
  evidence jsonb NOT NULL,
  source_sha256 text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, invoice_id),
  CONSTRAINT bookie_old_ar_settlements_source_unique UNIQUE (company_id, source_line_id),
  CONSTRAINT bookie_old_ar_balances_valid CHECK (
    original_amount > 0 AND closed_amount >= 0 AND remaining_amount >= 0
    AND original_amount = closed_amount + remaining_amount
  )
);