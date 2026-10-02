-- test-bootstrap: schema
-- Payment instruction batches and explicit ledger-account to bank account metadata.
CREATE TABLE IF NOT EXISTS bank_account_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  iban text NOT NULL,
  bic text,
  sepa_profile text NOT NULL DEFAULT 'pain.001.001.03',
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bank_account_metadata_account_uq
  ON bank_account_metadata(bank_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS bank_account_metadata_company_iban_uq
  ON bank_account_metadata(company_id, iban);
ALTER TABLE bank_account_metadata
  DROP CONSTRAINT IF EXISTS bank_account_metadata_profile_check;
ALTER TABLE bank_account_metadata
  ADD CONSTRAINT bank_account_metadata_profile_check
  CHECK (sepa_profile = 'pain.001.001.03');

CREATE TABLE IF NOT EXISTS payment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES accounts(id),
  execution_date date NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  transaction_count numeric(10,0) NOT NULL,
  control_sum numeric(18,2) NOT NULL,
  xml_snapshot text,
  exported_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_batches_status_check CHECK (status IN ('ready', 'exported', 'partially_executed', 'executed', 'rejected', 'cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_batches_company_idempotency_uq
  ON payment_batches(company_id, idempotency_key);
ALTER TABLE payment_batches
  DROP CONSTRAINT IF EXISTS payment_batches_status_check;
ALTER TABLE payment_batches
  ADD CONSTRAINT payment_batches_status_check
  CHECK (status IN ('ready', 'exported', 'partially_executed', 'executed', 'rejected', 'cancelled'));

CREATE TABLE IF NOT EXISTS payment_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES payment_batches(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  instruction jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_batch_items_payment_uq
  ON payment_batch_items(payment_id);