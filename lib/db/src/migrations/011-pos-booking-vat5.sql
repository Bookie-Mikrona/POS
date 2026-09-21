-- Migracija #138 — dopolnitev: DDV koda za 5% stopnjo v POS→ERP temeljnicah
-- Idempotentna (IF NOT EXISTS); samo dev.
ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS vat5_vat_code_id uuid
    REFERENCES vat_code(id) ON DELETE SET NULL;
