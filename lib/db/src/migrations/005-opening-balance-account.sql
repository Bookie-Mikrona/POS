-- Migacija 005: otvoritveni konto za začetno zalogo POS
ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS opening_balance_account_id UUID
    REFERENCES accounts(id) ON DELETE SET NULL;
