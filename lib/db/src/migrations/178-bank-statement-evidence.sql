-- test-bootstrap: audit

CREATE TABLE IF NOT EXISTS bank_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES accounts(id),
  source_iban text,
  statement_number text,
  statement_date date NOT NULL,
  period_from date,
  period_to date,
  opening_balance numeric(18,2),
  closing_balance numeric(18,2),
  currency text NOT NULL DEFAULT 'EUR',
  source_filename text NOT NULL,
  source_sha256 text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_statements_company_source_sha256_uq
  ON bank_statements(company_id, source_sha256);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id uuid NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  transaction_key text NOT NULL,
  line_number integer NOT NULL,
  booking_date date NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  reference text,
  counterparty_name text,
  counterparty_iban text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_lines_statement_tx_uq
  ON bank_statement_lines(statement_id, transaction_key);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS bank_statement_line_id uuid
  REFERENCES bank_statement_lines(id);

CREATE UNIQUE INDEX IF NOT EXISTS payments_bank_statement_line_uq
  ON payments(bank_statement_line_id)
  WHERE bank_statement_line_id IS NOT NULL;