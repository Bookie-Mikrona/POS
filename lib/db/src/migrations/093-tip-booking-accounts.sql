-- Ločeni analitični konti preprečijo, da bi se obdavčljiva napitnina
-- ali njen kartični strošek pomešal z običajno prodajo.
ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS tips_revenue_account_id uuid
    REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS tips_vat_account_id uuid
    REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS tips_card_fee_expense_account_id uuid
    REFERENCES accounts(id) ON DELETE SET NULL;