-- test-bootstrap: schema
ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS drobni_inventar boolean NOT NULL DEFAULT false;

ALTER TABLE artikli
  DROP CONSTRAINT IF EXISTS artikli_drobni_inventar_check;
ALTER TABLE artikli
  ADD CONSTRAINT artikli_drobni_inventar_check
  CHECK (
    NOT drobni_inventar OR (
      nabavni_artikel = true
      AND prodajni_artikel = false
      AND povratna_embalaza = false
      AND vrsta_artikla = 'material'
    )
  );

ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS drobni_inventar_expense_account_id uuid
  REFERENCES accounts(id) ON DELETE SET NULL;