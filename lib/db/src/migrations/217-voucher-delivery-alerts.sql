-- test-bootstrap: schema
-- Historical source record only. Do not execute during selective restoration.
CREATE TABLE IF NOT EXISTS voucher_delivery_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id uuid NOT NULL UNIQUE REFERENCES public_voucher_checkouts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  unit_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  last_error text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_voucher_delivery_alerts_open_company
  ON voucher_delivery_alerts (company_id, unit_id, created_at DESC)
  WHERE resolved_at IS NULL;