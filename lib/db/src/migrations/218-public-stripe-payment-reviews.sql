-- test-bootstrap: audit
-- Historical source record only. Do not execute during selective restoration.
CREATE TABLE IF NOT EXISTS public_stripe_payment_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  stripe_session_id text,
  checkout_id uuid REFERENCES public_voucher_checkouts(id) ON DELETE SET NULL,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  unit_id integer REFERENCES enote(id) ON DELETE SET NULL,
  metadata_company_id text,
  metadata_unit_id text,
  reason_code text NOT NULL,
  reason_detail text NOT NULL,
  expected_amount_cents integer,
  received_amount_cents integer,
  expected_currency text,
  received_currency text,
  payment_status text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_public_stripe_payment_reviews_open_company
  ON public_stripe_payment_reviews (company_id, unit_id, created_at DESC)
  WHERE status = 'open';