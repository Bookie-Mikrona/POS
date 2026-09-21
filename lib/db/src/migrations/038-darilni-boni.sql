-- 038: večnamenski darilni boni kot predplačila.
-- Samo razvojna migracija; zgodovinskih računov ne interpretiramo na novo.

ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS advance_payments_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warn_gift_voucher_negative boolean NOT NULL DEFAULT true;

ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS je_darilni_bon_izdaja boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS darilni_bon_gibi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  racun_id integer NOT NULL REFERENCES racuni(id) ON DELETE RESTRICT,
  tip text NOT NULL CHECK (tip IN ('izdaja', 'unovcitev')),
  znesek numeric(14,2) NOT NULL CHECK (znesek > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT darilni_bon_gibi_racun_tip_unique UNIQUE (racun_id, tip)
);

CREATE INDEX IF NOT EXISTS ix_darilni_bon_gibi_company
  ON darilni_bon_gibi(company_id);