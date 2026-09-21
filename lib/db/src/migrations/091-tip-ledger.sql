-- Time-effective legally auditable tip policy, allocation and settlement ledger.
CREATE TABLE IF NOT EXISTS tip_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enota_id integer REFERENCES enote(id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  effective_to date,
  mode text NOT NULL,
  evidence_type text NOT NULL,
  evidence_reference text NOT NULL,
  agreement_confirmed boolean NOT NULL DEFAULT false,
  card_fee_treatment text NOT NULL,
  card_fee_kind text NOT NULL DEFAULT 'none',
  card_fee_percent numeric(7,4),
  card_fee_flat_amount numeric(10,2),
  notes text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tip_policies_mode_check CHECK (mode IN ('direct_employee','independent_pool','employer_controlled')),
  CONSTRAINT tip_policies_evidence_type_check CHECK (evidence_type IN ('employment_contract','collective_agreement','internal_rule','other')),
  CONSTRAINT tip_policies_fee_treatment_check CHECK (card_fee_treatment IN ('employer_expense','deduct_from_tip')),
  CONSTRAINT tip_policies_fee_kind_check CHECK (card_fee_kind IN ('none','percentage','flat')),
  CONSTRAINT tip_policies_date_range_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT tip_policies_fee_percent_check CHECK (card_fee_percent IS NULL OR (card_fee_percent >= 0 AND card_fee_percent <= 100)),
  CONSTRAINT tip_policies_fee_configuration_check CHECK (
    (card_fee_kind = 'none' AND COALESCE(card_fee_percent, 0) = 0 AND COALESCE(card_fee_flat_amount, 0) = 0)
    OR (card_fee_kind = 'percentage' AND card_fee_percent > 0 AND COALESCE(card_fee_flat_amount, 0) = 0)
    OR (card_fee_kind = 'flat' AND card_fee_flat_amount > 0 AND COALESCE(card_fee_percent, 0) = 0 AND card_fee_treatment = 'employer_expense')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS tip_policies_company_effective_from_unique ON tip_policies(company_id, effective_from);
CREATE INDEX IF NOT EXISTS tip_policies_company_effective_range_idx ON tip_policies(company_id, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS tip_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  racun_id integer NOT NULL REFERENCES racuni(id) ON DELETE RESTRICT,
  tip_policy_id uuid NOT NULL REFERENCES tip_policies(id) ON DELETE RESTRICT,
  natakar_id integer REFERENCES natakari(id) ON DELETE RESTRICT,
  recipient_natakar_id integer REFERENCES natakari(id) ON DELETE RESTRICT,
  recipient_snapshot text NOT NULL,
  allocation_kind text NOT NULL DEFAULT 'manual',
  gross_amount numeric(12,2) NOT NULL,
  fee_amount numeric(12,2) NOT NULL DEFAULT 0,
  net_amount numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tip_allocations_kind_check CHECK (allocation_kind IN ('auto','manual')),
  CONSTRAINT tip_allocations_status_check CHECK (status IN ('open','settled','cancelled')),
  CONSTRAINT tip_allocations_amount_check CHECK (gross_amount >= 0 AND fee_amount >= 0 AND net_amount >= 0 AND net_amount = gross_amount - fee_amount)
);
CREATE INDEX IF NOT EXISTS tip_allocations_company_receipt_idx ON tip_allocations(company_id, racun_id);
CREATE INDEX IF NOT EXISTS tip_allocations_open_recipient_idx ON tip_allocations(company_id, status, recipient_natakar_id);
CREATE UNIQUE INDEX IF NOT EXISTS tip_allocations_auto_receipt_recipient_unique ON tip_allocations(racun_id, tip_policy_id, recipient_natakar_id) WHERE allocation_kind = 'auto';

CREATE TABLE IF NOT EXISTS tip_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  allocation_id uuid NOT NULL UNIQUE REFERENCES tip_allocations(id) ON DELETE RESTRICT,
  settlement_method text NOT NULL,
  settlement_reference text NOT NULL,
  settled_at timestamptz NOT NULL,
  settled_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tip_settlements_method_check CHECK (settlement_method IN ('cash','bank','payroll','student_service'))
);

ALTER TABLE racuni ADD COLUMN IF NOT EXISTS tip_policy_id uuid REFERENCES tip_policies(id) ON DELETE SET NULL;
ALTER TABLE racuni ADD COLUMN IF NOT EXISTS tip_policy_mode text;
ALTER TABLE racuni ADD COLUMN IF NOT EXISTS tip_card_fee_treatment text;
ALTER TABLE racuni ADD COLUMN IF NOT EXISTS tip_card_fee_kind text;
ALTER TABLE racuni ADD COLUMN IF NOT EXISTS tip_card_fee_tax_treatment text;
ALTER TABLE racuni ADD COLUMN IF NOT EXISTS tip_vat_amount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE racuni ADD COLUMN IF NOT EXISTS tip_card_fee_amount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE racuni ADD COLUMN IF NOT EXISTS tip_card_fee_flat_amount numeric(10,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE racuni ADD CONSTRAINT racuni_tip_policy_mode_check CHECK (tip_policy_mode IS NULL OR tip_policy_mode IN ('direct_employee','independent_pool','employer_controlled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE racuni ADD CONSTRAINT racuni_tip_fee_treatment_check CHECK (tip_card_fee_treatment IS NULL OR tip_card_fee_treatment IN ('employer_expense','deduct_from_tip'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;