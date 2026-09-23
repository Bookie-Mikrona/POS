-- test-bootstrap: schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public_venue_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id integer NOT NULL UNIQUE REFERENCES enote(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  description text,
  address text,
  phone text,
  email text,
  website text,
  primary_color text,
  logo_url text,
  cover_image_url text,
  max_party_size integer NOT NULL DEFAULT 12 CHECK (max_party_size BETWEEN 1 AND 100),
  slot_minutes integer NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 15 AND 240),
  slot_capacity integer NOT NULL DEFAULT 40 CHECK (slot_capacity > 0),
  opening_hours jsonb NOT NULL DEFAULT '[]'::jsonb,
  date_exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public_venue_profiles(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  unit_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  table_id integer NOT NULL REFERENCES mize(id) ON DELETE RESTRICT,
  reservation_row_id integer REFERENCES rezervacije_miz(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_fingerprint text,
  management_token_hash text NOT NULL UNIQUE,
  management_token_encrypted text,
  party_size integer NOT NULL CHECK (party_size > 0),
  starts_at timestamptz NOT NULL,
  guest_name text NOT NULL,
  email text NOT NULL,
  phone text,
  note text,
  privacy_accepted_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  UNIQUE(profile_id, idempotency_key)
);
ALTER TABLE public_reservations ADD COLUMN IF NOT EXISTS reservation_row_id integer REFERENCES rezervacije_miz(id) ON DELETE RESTRICT;
ALTER TABLE public_reservations ADD COLUMN IF NOT EXISTS management_token_encrypted text;
ALTER TABLE public_reservations ADD COLUMN IF NOT EXISTS request_fingerprint text;
CREATE INDEX IF NOT EXISTS ix_public_reservations_slot ON public_reservations(unit_id, starts_at, status);

CREATE TABLE IF NOT EXISTS public_reservation_audit (
  id bigserial PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES public_reservations(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_voucher_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public_venue_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  image_url text,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public_voucher_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public_voucher_products(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public_voucher_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public_venue_profiles(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  unit_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_fingerprint text,
  stripe_session_id text UNIQUE,
  creation_token text,
  creation_started_at timestamptz,
  checkout_url text,
  expected_amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  buyer_name text NOT NULL,
  buyer_email text NOT NULL,
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  message text,
  items jsonb NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','open','complete','expired','cancelled')),
  payment_status text,
  privacy_accepted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id, idempotency_key)
);
ALTER TABLE public_voucher_checkouts ADD COLUMN IF NOT EXISTS creation_token text;
ALTER TABLE public_voucher_checkouts ADD COLUMN IF NOT EXISTS creation_started_at timestamptz;
ALTER TABLE public_voucher_checkouts ADD COLUMN IF NOT EXISTS request_fingerprint text;
CREATE TABLE IF NOT EXISTS public_stripe_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS individual_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id uuid NOT NULL REFERENCES public_voucher_checkouts(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  unit_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  code_hash text NOT NULL UNIQUE,
  code_encrypted text,
  code_suffix text NOT NULL,
  initial_amount_cents integer NOT NULL CHECK (initial_amount_cents > 0),
  currency text NOT NULL DEFAULT 'EUR',
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','spent','void')),
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','failed')),
  delivered_at timestamptz,
  delivery_error text,
  issued_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS code_encrypted text;
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending';
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivery_error text;
CREATE TABLE IF NOT EXISTS individual_voucher_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES individual_vouchers(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  operation_key text NOT NULL,
  type text NOT NULL CHECK (type IN ('issue','redeem','reverse')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  receipt_id integer REFERENCES racuni(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(voucher_id, operation_key)
);