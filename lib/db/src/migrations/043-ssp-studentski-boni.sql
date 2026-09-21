ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS znesek_subvencija numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ssp_referenca text;

ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS subsidy_receivable_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subsidy_counterparty_id uuid REFERENCES counterparties(id) ON DELETE SET NULL;