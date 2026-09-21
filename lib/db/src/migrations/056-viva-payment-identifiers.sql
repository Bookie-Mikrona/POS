-- 056-viva-payment-identifiers.sql
--
-- Trajna Viva sled na računu. NULL ostane dovoljen za vse ne-Viva in stare
-- račune; obstoječi viva_terminal_session_id se ne spreminja.

ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS viva_transaction_id text,
  ADD COLUMN IF NOT EXISTS viva_order_code text;