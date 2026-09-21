-- test-bootstrap: schema
-- Stabilne obravnave POS OCR vrstic in ločeni konti neposrednih stroškov.
ALTER TABLE prejemnice_postavke
  DROP CONSTRAINT IF EXISTS prejemnice_postavke_vrstica_tip_check;
UPDATE prejemnice_postavke
   SET vrstica_tip = 'poraba_surovin'
 WHERE vrstica_tip = 'strosek';
ALTER TABLE prejemnice_postavke
  ADD CONSTRAINT prejemnice_postavke_vrstica_tip_check
  CHECK (vrstica_tip IN ('zaloga', 'poraba_surovin', 'prevoz'));
ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS raw_material_expense_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inbound_freight_expense_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;