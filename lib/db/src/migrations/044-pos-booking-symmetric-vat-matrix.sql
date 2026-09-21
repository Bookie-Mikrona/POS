-- ============================================================================
-- Migration 044: Polna POS prihodkovna/DDV matrika 22 % × 9,5 % × 5 %
-- ============================================================================

ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS revenue_material_5_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revenue_goods_5_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revenue_service_22_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revenue_service_95_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revenue_service_5_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vat_5_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

-- Stari skupni konto storitev je veljal za 22 % in 9,5 %. Vrednosti prenesemo
-- v eksplicitni polji, da nadgradnja ne prekine že nastavljenega prometa.
UPDATE pos_booking_settings
SET
  revenue_service_22_account_id = COALESCE(revenue_service_22_account_id, revenue_service_account_id),
  revenue_service_95_account_id = COALESCE(revenue_service_95_account_id, revenue_service_account_id)
WHERE revenue_service_account_id IS NOT NULL;

-- Nova, izrecna kategorija je edini samodejni sprožilec 5 %. Obstoječih
-- kategorij hrane, pijač in »ostalo« ne spreminjamo.
INSERT INTO vat_rule (priority, supply_kind, tax_category, added_sugar, rate, configurable, label)
SELECT 10, NULL, 'vat_super_reduced_5', NULL, 5.00, false, 'Znižana stopnja DDV 5 %'
WHERE NOT EXISTS (
  SELECT 1 FROM vat_rule WHERE label = 'Znižana stopnja DDV 5 %'
);