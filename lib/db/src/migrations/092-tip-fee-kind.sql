-- Distinguish a percentage card fee attributable to a tip from a nominal
-- transaction fee, which FURS says must never be allocated to the tip.
ALTER TABLE tip_policies ADD COLUMN IF NOT EXISTS card_fee_kind text NOT NULL DEFAULT 'none';
ALTER TABLE tip_policies ADD COLUMN IF NOT EXISTS card_fee_flat_amount numeric(10,2);
UPDATE tip_policies
SET card_fee_kind = 'percentage'
WHERE COALESCE(card_fee_percent, 0) > 0
  AND card_fee_kind = 'none';
DO $$ BEGIN
  ALTER TABLE tip_policies ADD CONSTRAINT tip_policies_fee_kind_check
    CHECK (card_fee_kind IN ('none','percentage','flat'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tip_policies ADD CONSTRAINT tip_policies_fee_configuration_check CHECK (
    (card_fee_kind = 'none' AND COALESCE(card_fee_percent, 0) = 0 AND COALESCE(card_fee_flat_amount, 0) = 0)
    OR (card_fee_kind = 'percentage' AND card_fee_percent > 0 AND COALESCE(card_fee_flat_amount, 0) = 0)
    OR (card_fee_kind = 'flat' AND card_fee_flat_amount > 0 AND COALESCE(card_fee_percent, 0) = 0 AND card_fee_treatment = 'employer_expense')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE racuni ADD COLUMN IF NOT EXISTS tip_card_fee_kind text;
ALTER TABLE racuni ADD COLUMN IF NOT EXISTS tip_card_fee_tax_treatment text;
ALTER TABLE racuni ADD COLUMN IF NOT EXISTS tip_card_fee_flat_amount numeric(10,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE racuni ADD CONSTRAINT racuni_tip_fee_kind_check
    CHECK (tip_card_fee_kind IS NULL OR tip_card_fee_kind IN ('none','percentage','flat'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE racuni ADD CONSTRAINT racuni_tip_fee_tax_treatment_check
    CHECK (tip_card_fee_tax_treatment IS NULL OR tip_card_fee_tax_treatment IN (
      'not_applicable','private_nondeductible','business_deductible','withheld_from_employee'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;