-- Operational, append-only employee tip-pool ledger.  Existing receipts remain untouched.
CREATE TABLE IF NOT EXISTS tip_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  decision_type text NOT NULL CHECK (decision_type IN ('employee_agreement','collective_agreement','internal_rule')),
  rule_reference text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  evidence_reference text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS tip_pools_company_effective_idx ON tip_pools(company_id, effective_from, effective_to);

ALTER TABLE tip_allocations ADD COLUMN IF NOT EXISTS tip_pool_id uuid REFERENCES tip_pools(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS tip_allocations_pool_idx ON tip_allocations(company_id, tip_pool_id) WHERE tip_pool_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tip_pool_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pool_id uuid NOT NULL REFERENCES tip_pools(id) ON DELETE RESTRICT,
  allocation_id uuid REFERENCES tip_allocations(id) ON DELETE RESTRICT,
  recipient_natakar_id integer REFERENCES natakari(id) ON DELETE RESTRICT,
  recipient_snapshot text,
  entry_type text NOT NULL CHECK (entry_type IN ('allocation','distribution','reversal')),
  amount numeric(12,2) NOT NULL CHECK (amount <> 0),
  reversal_of_id uuid REFERENCES tip_pool_entries(id) ON DELETE RESTRICT,
  evidence_reference text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((entry_type = 'allocation' AND allocation_id IS NOT NULL AND amount > 0)
      OR (entry_type = 'distribution' AND recipient_snapshot IS NOT NULL AND amount < 0)
      OR (entry_type = 'reversal' AND reversal_of_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS tip_pool_entries_one_allocation ON tip_pool_entries(allocation_id) WHERE entry_type = 'allocation';
CREATE INDEX IF NOT EXISTS tip_pool_entries_company_pool_created_idx ON tip_pool_entries(company_id, pool_id, created_at);

CREATE TABLE IF NOT EXISTS tip_historical_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  racun_id integer NOT NULL UNIQUE REFERENCES racuni(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','confirmed')),
  note text,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'pending' AND confirmed_by IS NULL AND confirmed_at IS NULL)
      OR (state = 'confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);

ALTER TABLE tip_settlements ADD COLUMN IF NOT EXISTS evidence_reference text;
ALTER TABLE tip_settlements ADD COLUMN IF NOT EXISTS employer_document_type text;
ALTER TABLE tip_settlements ADD COLUMN IF NOT EXISTS employer_document_reference text;
UPDATE tip_settlements SET evidence_reference = settlement_reference WHERE evidence_reference IS NULL;
ALTER TABLE tip_settlements ALTER COLUMN evidence_reference SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tip_settlements_employer_document_check'
      AND conrelid = 'tip_settlements'::regclass
  ) THEN
    ALTER TABLE tip_settlements ADD CONSTRAINT tip_settlements_employer_document_check CHECK (
      (employer_document_type IS NULL AND employer_document_reference IS NULL)
      OR (employer_document_type IN ('payroll','other_income','student_referral') AND employer_document_reference IS NOT NULL)
    );
  END IF;
END
$$;