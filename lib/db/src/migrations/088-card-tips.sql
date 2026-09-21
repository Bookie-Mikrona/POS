-- Kartična napitnina je ločena obveznost in ni prodajna postavka.
ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS znesek_napitnina numeric(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS tips_liability_account_id uuid
  REFERENCES accounts(id) ON DELETE SET NULL;