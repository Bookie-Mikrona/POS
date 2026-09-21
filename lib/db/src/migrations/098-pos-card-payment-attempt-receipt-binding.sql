ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS card_payment_attempt_id uuid
  REFERENCES pos_karticna_placila_attempt(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS racuni_card_payment_attempt_id_unique
  ON racuni (card_payment_attempt_id);

ALTER TABLE pos_racun_izdaja_zahteve
  ADD COLUMN IF NOT EXISTS card_payment_attempt_id uuid
  REFERENCES pos_karticna_placila_attempt(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS pos_racun_izdaja_card_payment_attempt_unique
  ON pos_racun_izdaja_zahteve (card_payment_attempt_id);

CREATE UNIQUE INDEX IF NOT EXISTS pos_karticna_placila_attempt_active_payment_unique
  ON pos_karticna_placila_attempt (company_id, enota_id, provider, narocilo_id, znesek)
  WHERE status IN ('reserved', 'pending', 'unknown');