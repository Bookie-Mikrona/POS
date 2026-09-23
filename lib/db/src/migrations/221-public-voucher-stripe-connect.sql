-- test-bootstrap: schema
-- Per-company Stripe Connect Standard account snapshots for direct voucher charges.

CREATE TABLE IF NOT EXISTS public_company_stripe_connect (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  account_id text UNIQUE,
  livemode boolean,
  details_submitted boolean NOT NULL DEFAULT false,
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  oauth_state_hash text,
  oauth_state_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_company_stripe_connect_account_format
    CHECK (account_id IS NULL OR account_id ~ '^acct_[A-Za-z0-9]+$'),
  CONSTRAINT public_company_stripe_connect_oauth_state_pair
    CHECK ((oauth_state_hash IS NULL) = (oauth_state_expires_at IS NULL))
);

ALTER TABLE public_voucher_checkouts
  ADD COLUMN IF NOT EXISTS connect_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_livemode boolean,
  ADD COLUMN IF NOT EXISTS stripe_idempotency_key text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_voucher_checkout_connect_mode_pair') THEN
    ALTER TABLE public_voucher_checkouts
      ADD CONSTRAINT public_voucher_checkout_connect_mode_pair
      CHECK ((connect_account_id IS NULL) = (stripe_livemode IS NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_voucher_checkout_connect_idempotency') THEN
    ALTER TABLE public_voucher_checkouts
      ADD CONSTRAINT public_voucher_checkout_connect_idempotency
      CHECK (stripe_idempotency_key IS NULL OR connect_account_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_public_voucher_checkouts_connect_account
  ON public_voucher_checkouts(connect_account_id)
  WHERE connect_account_id IS NOT NULL;