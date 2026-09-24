-- test-bootstrap: schema
-- Durable pre-FURS reservations for individual online voucher redemptions.
CREATE TABLE IF NOT EXISTS pos_individual_voucher_redemption_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL UNIQUE REFERENCES pos_racun_izdaja_zahteve(id) ON DELETE RESTRICT,
  voucher_id uuid NOT NULL REFERENCES individual_vouchers(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  receipt_id integer REFERENCES racuni(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'committed', 'released', 'reversed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  reversed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_individual_voucher_hold_receipt
  ON pos_individual_voucher_redemption_holds(receipt_id) WHERE receipt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_pos_individual_voucher_hold_available
  ON pos_individual_voucher_redemption_holds(voucher_id, status);