-- test-bootstrap: schema
ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS returnable_packaging_account_id uuid
  REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE embalazni_prometi
  ADD COLUMN IF NOT EXISTS operation_key uuid,
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS embalazni_prometi_operation_key_unique
  ON embalazni_prometi(enota_id, operation_key) WHERE operation_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS embalazni_prometi_journal_entry_unique
  ON embalazni_prometi(journal_entry_id) WHERE journal_entry_id IS NOT NULL;