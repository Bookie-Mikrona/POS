ALTER TABLE pos_karticna_placila_attempt
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'receipt';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pos_karticna_placila_attempt_purpose_check'
  ) THEN
    ALTER TABLE pos_karticna_placila_attempt
      ADD CONSTRAINT pos_karticna_placila_attempt_purpose_check
      CHECK (purpose IN ('receipt', 'gift_voucher')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pos_karticna_placila_attempt_gift_order_check'
  ) THEN
    ALTER TABLE pos_karticna_placila_attempt
      ADD CONSTRAINT pos_karticna_placila_attempt_gift_order_check
      CHECK (purpose <> 'gift_voucher' OR narocilo_id IS NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pos_karticna_placila_attempt_receipt_order_check'
  ) THEN
    ALTER TABLE pos_karticna_placila_attempt
      ADD CONSTRAINT pos_karticna_placila_attempt_receipt_order_check
      CHECK (purpose <> 'receipt' OR narocilo_id > 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE darilni_bon_izdaje
  ADD COLUMN IF NOT EXISTS card_payment_attempt_id uuid
  REFERENCES pos_karticna_placila_attempt(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS darilni_bon_izdaje_card_payment_attempt_unique
  ON darilni_bon_izdaje (card_payment_attempt_id);

ALTER TABLE darilni_bon_izdaje
  DROP CONSTRAINT IF EXISTS darilni_bon_izdaje_terminalsko_placilo_preverjeno_check;

ALTER TABLE darilni_bon_izdaje
  ADD CONSTRAINT darilni_bon_izdaje_terminalsko_placilo_preverjeno_check
  CHECK (terminalsko_placilo_preverjeno IN ('nepreverjeno', 'preverjeno')) NOT VALID;