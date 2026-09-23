-- test-bootstrap: schema
-- Reviewed forward reconciliation for the restored POS/public feature set.
-- This migration deliberately preserves the active 198/199 lineage, uses
-- additive/idempotent DDL plus narrowly scoped controlled replacements, and
-- must be safe to rerun on a partially upgraded
-- development schema. Historical 198-219 snapshots remain inert evidence.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE artikli ADD COLUMN IF NOT EXISTS malica_vloga text NOT NULL DEFAULT 'none';
ALTER TABLE postavke ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE postavke ADD COLUMN IF NOT EXISTS malica_daily_main_item_id integer;
ALTER TABLE postavke ADD COLUMN IF NOT EXISTS malica_daily_course_id integer;
ALTER TABLE postavke ADD COLUMN IF NOT EXISTS package_status text NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS malica_groups (
  id serial PRIMARY KEY, enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  code text NOT NULL, name text NOT NULL, sort_order integer NOT NULL,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT malica_groups_enota_code_uq UNIQUE (enota_id, code),
  CONSTRAINT malica_groups_enota_order_uq UNIQUE (enota_id, sort_order)
);
CREATE TABLE IF NOT EXISTS malica_group_prices (
  id serial PRIMARY KEY, group_id integer NOT NULL REFERENCES malica_groups(id) ON DELETE CASCADE,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  price_cents integer NOT NULL, valid_from date NOT NULL, valid_to date,
  status text NOT NULL DEFAULT 'scheduled', reason text, created_by text,
  confirmed_by text, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
);
CREATE TABLE IF NOT EXISTS malica_article_assignments (
  id serial PRIMARY KEY, enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  artikel_id integer NOT NULL REFERENCES artikli(id) ON DELETE CASCADE,
  group_id integer REFERENCES malica_groups(id) ON DELETE CASCADE,
  role text NOT NULL, malica_price_cents integer, auto_sync_price boolean NOT NULL DEFAULT true,
  valid_from date, valid_to date, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS malica_daily_offers (
  id serial PRIMARY KEY, enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  business_date date NOT NULL, status text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1, published_at timestamptz, published_by text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS malica_daily_main_items (
  id serial PRIMARY KEY, offer_id integer NOT NULL REFERENCES malica_daily_offers(id) ON DELETE CASCADE,
  group_id integer NOT NULL REFERENCES malica_groups(id) ON DELETE RESTRICT,
  artikel_id integer NOT NULL REFERENCES artikli(id) ON DELETE RESTRICT,
  position integer NOT NULL DEFAULT 0, enabled boolean NOT NULL DEFAULT true,
  article_name_snapshot text NOT NULL, price_cents_snapshot integer NOT NULL,
  available_quantity numeric(14,4)
);
CREATE TABLE IF NOT EXISTS malica_daily_included_courses (
  id serial PRIMARY KEY, offer_id integer NOT NULL REFERENCES malica_daily_offers(id) ON DELETE CASCADE,
  course_type text NOT NULL, artikel_id integer NOT NULL REFERENCES artikli(id) ON DELETE RESTRICT,
  article_name_snapshot text NOT NULL, quantity numeric(14,4) NOT NULL DEFAULT 0,
  reserved_quantity numeric(14,4) NOT NULL DEFAULT 0, consumed_quantity numeric(14,4) NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS malica_partner_group_prices (
  id serial PRIMARY KEY, enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  kupec_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  group_id integer NOT NULL REFERENCES malica_groups(id) ON DELETE CASCADE,
  price_cents integer NOT NULL, valid_from date NOT NULL, valid_to date,
  active boolean NOT NULL DEFAULT true, created_by text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS malica_sale_snapshots (
  id serial PRIMARY KEY, postavka_id integer NOT NULL UNIQUE REFERENCES postavke(id) ON DELETE CASCADE,
  offer_id integer NOT NULL REFERENCES malica_daily_offers(id) ON DELETE RESTRICT,
  offer_version integer NOT NULL, group_id integer NOT NULL REFERENCES malica_groups(id) ON DELETE RESTRICT,
  regular_price_cents integer NOT NULL, actual_price_cents integer NOT NULL, price_source text NOT NULL,
  partner_id uuid REFERENCES counterparties(id) ON DELETE RESTRICT,
  main_item_id integer NOT NULL REFERENCES malica_daily_main_items(id) ON DELETE RESTRICT,
  soup_id integer REFERENCES malica_daily_included_courses(id) ON DELETE RESTRICT,
  dessert_id integer REFERENCES malica_daily_included_courses(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  selected_course_ids jsonb NOT NULL DEFAULT '[]'::jsonb, extra_course_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  contract_id integer, contract_version integer, regular_gross_cents integer,
  partner_covered_cents integer, guest_payable_cents integer, surcharge_cents integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS malica_contracts (
  id serial PRIMARY KEY, enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1, mode text NOT NULL, split_kind text, split_value integer NOT NULL DEFAULT 0,
  higher_group_surcharge_cents integer NOT NULL DEFAULT 0, monthly_coverage_limit_cents integer,
  valid_from date NOT NULL, valid_to date, requires_beneficiary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true, created_by text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS malica_beneficiaries (
  id serial PRIMARY KEY, enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
  identifier_type text NOT NULL, identifier_hash text NOT NULL, masked_suffix text,
  daily_limit integer, monthly_coverage_override_cents integer, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS malica_allocations (
  id serial PRIMARY KEY, sale_snapshot_id integer NOT NULL UNIQUE REFERENCES malica_sale_snapshots(id) ON DELETE RESTRICT,
  narocilo_id integer NOT NULL REFERENCES narocila(id) ON DELETE RESTRICT,
  partner_cents integer NOT NULL, guest_cents integer NOT NULL, surcharge_cents integer NOT NULL DEFAULT 0,
  contract_id integer REFERENCES malica_contracts(id) ON DELETE RESTRICT, business_date date,
  vat_rate_bps integer NOT NULL DEFAULT 0, vat_base_cents integer NOT NULL DEFAULT 0,
  vat_cents integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS malica_contract_usage (
  id serial PRIMARY KEY, contract_id integer NOT NULL REFERENCES malica_contracts(id) ON DELETE RESTRICT,
  beneficiary_id integer REFERENCES malica_beneficiaries(id) ON DELETE RESTRICT,
  sale_snapshot_id integer NOT NULL REFERENCES malica_sale_snapshots(id) ON DELETE RESTRICT,
  business_date date NOT NULL, covered_cents integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS malica_allocation_claims (
  id serial PRIMARY KEY, allocation_id integer NOT NULL UNIQUE REFERENCES malica_allocations(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_lunch_offers (
  id serial PRIMARY KEY, enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  business_date date NOT NULL, status text NOT NULL DEFAULT 'draft',
  base_flat_amount numeric(10,2) NOT NULL DEFAULT 8.00, starter_flat_amount numeric(10,2) NOT NULL DEFAULT 10.00,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS daily_lunch_offer_choices (
  id serial PRIMARY KEY, offer_id integer NOT NULL REFERENCES daily_lunch_offers(id) ON DELETE CASCADE,
  role text NOT NULL, artikel_id integer NOT NULL REFERENCES artikli(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0, UNIQUE (offer_id, role, artikel_id)
);
CREATE TABLE IF NOT EXISTS daily_lunch_sale_snapshots (
  id serial PRIMARY KEY, postavka_id integer NOT NULL REFERENCES postavke(id) ON DELETE CASCADE,
  narocilo_id integer NOT NULL REFERENCES narocila(id) ON DELETE CASCADE,
  offer_id integer NOT NULL REFERENCES daily_lunch_offers(id) ON DELETE RESTRICT,
  business_date date NOT NULL, mode text NOT NULL, selected_dishes jsonb NOT NULL,
  main_live_price numeric(10,2) NOT NULL, base_flat_amount numeric(10,2) NOT NULL,
  starter_flat_amount numeric(10,2) NOT NULL, total numeric(10,2) NOT NULL,
  vat_requirements jsonb NOT NULL, availability_requirements jsonb NOT NULL,
  pairing_group_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(postavka_id)
);

CREATE TABLE IF NOT EXISTS public_venue_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), unit_id integer NOT NULL UNIQUE REFERENCES enote(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE, slug text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true, description text, address text, phone text, email text,
  website text, primary_color text, logo_url text, cover_image_url text,
  max_party_size integer NOT NULL DEFAULT 12, slot_minutes integer NOT NULL DEFAULT 30,
  slot_capacity integer NOT NULL DEFAULT 40, opening_hours jsonb NOT NULL DEFAULT '[]'::jsonb,
  date_exceptions jsonb NOT NULL DEFAULT '[]'::jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES public_venue_profiles(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT, unit_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  table_id integer NOT NULL REFERENCES mize(id) ON DELETE RESTRICT, reservation_row_id integer REFERENCES rezervacije_miz(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL, request_fingerprint text, management_token_hash text NOT NULL UNIQUE,
  management_token_encrypted text, party_size integer NOT NULL, starts_at timestamptz NOT NULL,
  guest_name text NOT NULL, email text NOT NULL, phone text, note text, privacy_accepted_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed', created_at timestamptz NOT NULL DEFAULT now(), cancelled_at timestamptz,
  UNIQUE(profile_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS public_reservation_audit (
  id bigserial PRIMARY KEY, reservation_id uuid NOT NULL REFERENCES public_reservations(id) ON DELETE RESTRICT,
  event_type text NOT NULL, data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public_voucher_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES public_venue_profiles(id) ON DELETE CASCADE,
  name text NOT NULL, description text, image_url text, active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public_voucher_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES public_voucher_products(id) ON DELETE CASCADE,
  name text NOT NULL, amount_cents integer NOT NULL, currency text NOT NULL DEFAULT 'EUR', active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public_voucher_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES public_venue_profiles(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT, unit_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL, request_fingerprint text, stripe_session_id text UNIQUE,
  creation_token text, creation_started_at timestamptz, checkout_url text, expected_amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EUR', buyer_name text NOT NULL, buyer_email text NOT NULL,
  recipient_name text NOT NULL, recipient_email text NOT NULL, message text, items jsonb NOT NULL,
  status text NOT NULL DEFAULT 'created', payment_status text, privacy_accepted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(profile_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS public_stripe_events (event_id text PRIMARY KEY, event_type text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS individual_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), checkout_id uuid NOT NULL REFERENCES public_voucher_checkouts(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT, unit_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  code_hash text NOT NULL UNIQUE, code_encrypted text, code_suffix text NOT NULL, initial_amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EUR', recipient_name text NOT NULL, recipient_email text NOT NULL, expires_at timestamptz,
  status text NOT NULL DEFAULT 'active', delivery_status text NOT NULL DEFAULT 'pending',
  delivered_at timestamptz, delivery_error text, issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS individual_voucher_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), voucher_id uuid NOT NULL REFERENCES individual_vouchers(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT, operation_key text NOT NULL,
  type text NOT NULL, amount_cents integer NOT NULL, receipt_id integer REFERENCES racuni(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(voucher_id, operation_key)
);
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivery_next_attempt_at timestamptz;
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivery_last_attempt_at timestamptz;
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivery_claim_token text;
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivery_claimed_at timestamptz;

CREATE TABLE IF NOT EXISTS voucher_delivery_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), checkout_id uuid NOT NULL UNIQUE REFERENCES public_voucher_checkouts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE, unit_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  last_error text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE TABLE IF NOT EXISTS public_stripe_payment_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id text NOT NULL UNIQUE, event_type text NOT NULL,
  stripe_session_id text, checkout_id uuid REFERENCES public_voucher_checkouts(id) ON DELETE SET NULL,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL, unit_id integer REFERENCES enote(id) ON DELETE SET NULL,
  metadata_company_id text, metadata_unit_id text, reason_code text NOT NULL, reason_detail text NOT NULL,
  expected_amount_cents integer, received_amount_cents integer, expected_currency text, received_currency text,
  payment_status text, status text NOT NULL DEFAULT 'open', resolved_at timestamptz, resolved_by text,
  resolution_note text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public_stripe_payment_review_audit (
  id bigserial PRIMARY KEY, review_id uuid NOT NULL REFERENCES public_stripe_payment_reviews(id) ON DELETE CASCADE,
  action text NOT NULL, actor_clerk_user_id text, note text, data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stripe_connection_alerts (
  alert_key text PRIMARY KEY, status text NOT NULL DEFAULT 'open',
  first_detected_at timestamptz NOT NULL DEFAULT now(), last_detected_at timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1, last_observed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_postavke_narocilo_idempotency
  ON postavke(narocilo_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_postavke_malica_daily_main_item ON postavke(malica_daily_main_item_id);
CREATE INDEX IF NOT EXISTS ix_postavke_malica_daily_course ON postavke(malica_daily_course_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_malica_daily_offers_one_published
  ON malica_daily_offers(enota_id, business_date) WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS daily_lunch_one_offer_per_unit_date ON daily_lunch_offers(enota_id, business_date);
CREATE INDEX IF NOT EXISTS ix_daily_lunch_snapshots_business_date ON daily_lunch_sale_snapshots(business_date);
CREATE INDEX IF NOT EXISTS ix_public_reservations_slot ON public_reservations(unit_id, starts_at, status);
CREATE INDEX IF NOT EXISTS ix_public_stripe_payment_reviews_open_company
  ON public_stripe_payment_reviews(company_id, unit_id, created_at DESC) WHERE status = 'open';

-- The archived migrations were deliberately split into small revisions.  The
-- following reconciliation is intentionally explicit: CREATE TABLE IF NOT
-- EXISTS does not repair a table that a partially upgraded database already
-- has, so every later column, key, check, FK, trigger, and index is repaired
-- below as well.
ALTER TABLE artikli ADD COLUMN IF NOT EXISTS malica_vloga text NOT NULL DEFAULT 'none';
ALTER TABLE postavke ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE postavke ADD COLUMN IF NOT EXISTS malica_daily_main_item_id integer;
ALTER TABLE postavke ADD COLUMN IF NOT EXISTS malica_daily_course_id integer;
ALTER TABLE postavke ADD COLUMN IF NOT EXISTS package_status text NOT NULL DEFAULT 'active';
ALTER TABLE malica_sale_snapshots ADD COLUMN IF NOT EXISTS soup_id integer;
ALTER TABLE malica_sale_snapshots ADD COLUMN IF NOT EXISTS dessert_id integer;
ALTER TABLE malica_sale_snapshots ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE malica_sale_snapshots ADD COLUMN IF NOT EXISTS selected_course_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE malica_sale_snapshots ADD COLUMN IF NOT EXISTS extra_course_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE malica_sale_snapshots ADD COLUMN IF NOT EXISTS contract_id integer;
ALTER TABLE malica_sale_snapshots ADD COLUMN IF NOT EXISTS contract_version integer;
ALTER TABLE malica_sale_snapshots ADD COLUMN IF NOT EXISTS regular_gross_cents integer;
ALTER TABLE malica_sale_snapshots ADD COLUMN IF NOT EXISTS partner_covered_cents integer;
ALTER TABLE malica_sale_snapshots ADD COLUMN IF NOT EXISTS guest_payable_cents integer;
ALTER TABLE malica_sale_snapshots ADD COLUMN IF NOT EXISTS surcharge_cents integer NOT NULL DEFAULT 0;
ALTER TABLE malica_allocations ADD COLUMN IF NOT EXISTS business_date date;
ALTER TABLE malica_allocations ADD COLUMN IF NOT EXISTS vat_rate_bps integer NOT NULL DEFAULT 0;
ALTER TABLE malica_allocations ADD COLUMN IF NOT EXISTS vat_base_cents integer NOT NULL DEFAULT 0;
ALTER TABLE malica_allocations ADD COLUMN IF NOT EXISTS vat_cents integer NOT NULL DEFAULT 0;
ALTER TABLE malica_allocation_claims ADD COLUMN IF NOT EXISTS invoice_id uuid;
ALTER TABLE malica_allocation_claims ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivery_next_attempt_at timestamptz;
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivery_last_attempt_at timestamptz;
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivery_claim_token text;
ALTER TABLE individual_vouchers ADD COLUMN IF NOT EXISTS delivery_claimed_at timestamptz;

-- Replacements explicitly required by the archived revisions.
ALTER TABLE malica_partner_group_prices
  DROP CONSTRAINT IF EXISTS malica_partner_group_prices_uq;
ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_contract_summary_period_unique;
DROP INDEX IF EXISTS invoices_contract_summary_period_unique;
ALTER TABLE postavke
  DROP CONSTRAINT IF EXISTS postavke_package_status_check;
ALTER TABLE individual_vouchers
  DROP CONSTRAINT IF EXISTS individual_vouchers_delivery_status_check;
ALTER TABLE malica_allocations ALTER COLUMN business_date SET NOT NULL;
ALTER TABLE malica_allocation_claims ALTER COLUMN invoice_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artikli_malica_vloga_check') THEN
    ALTER TABLE artikli ADD CONSTRAINT artikli_malica_vloga_check
      CHECK (malica_vloga IN ('none', 'main', 'soup', 'dessert')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'postavke_malica_daily_main_item_fk') THEN
    ALTER TABLE postavke ADD CONSTRAINT postavke_malica_daily_main_item_fk
      FOREIGN KEY (malica_daily_main_item_id) REFERENCES malica_daily_main_items(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'postavke_malica_daily_course_fk') THEN
    ALTER TABLE postavke ADD CONSTRAINT postavke_malica_daily_course_fk
      FOREIGN KEY (malica_daily_course_id) REFERENCES malica_daily_included_courses(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_sale_snapshots_soup_fk') THEN
    ALTER TABLE malica_sale_snapshots ADD CONSTRAINT malica_sale_snapshots_soup_fk
      FOREIGN KEY (soup_id) REFERENCES malica_daily_included_courses(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_sale_snapshots_dessert_fk') THEN
    ALTER TABLE malica_sale_snapshots ADD CONSTRAINT malica_sale_snapshots_dessert_fk
      FOREIGN KEY (dessert_id) REFERENCES malica_daily_included_courses(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_sale_snapshots_contract_fk') THEN
    ALTER TABLE malica_sale_snapshots ADD CONSTRAINT malica_sale_snapshots_contract_fk
      FOREIGN KEY (contract_id) REFERENCES malica_contracts(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_allocation_claims_invoice_fk') THEN
    ALTER TABLE malica_allocation_claims ADD CONSTRAINT malica_allocation_claims_invoice_fk
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_allocation_claims_allocation_uq') THEN
    ALTER TABLE malica_allocation_claims ADD CONSTRAINT malica_allocation_claims_allocation_uq
      UNIQUE (allocation_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_partner_group_prices_uq') THEN
    ALTER TABLE malica_partner_group_prices ADD CONSTRAINT malica_partner_group_prices_uq
      UNIQUE (enota_id, kupec_id, group_id, valid_from);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'postavke_package_status_check') THEN
    ALTER TABLE postavke ADD CONSTRAINT postavke_package_status_check
      CHECK (package_status IN ('active', 'cancelled')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'individual_vouchers_delivery_status_check') THEN
    ALTER TABLE individual_vouchers ADD CONSTRAINT individual_vouchers_delivery_status_check
      CHECK (delivery_status IN ('pending', 'sending', 'sent', 'failed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_stripe_payment_reviews_status_check') THEN
    ALTER TABLE public_stripe_payment_reviews ADD CONSTRAINT public_stripe_payment_reviews_status_check
      CHECK (status IN ('open', 'resolved')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_groups_sort_order_check') THEN
    ALTER TABLE malica_groups ADD CONSTRAINT malica_groups_sort_order_check
      CHECK (sort_order BETWEEN 1 AND 4) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_groups_enota_code_uq') THEN
    ALTER TABLE malica_groups ADD CONSTRAINT malica_groups_enota_code_uq UNIQUE (enota_id, code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_groups_enota_order_uq') THEN
    ALTER TABLE malica_groups ADD CONSTRAINT malica_groups_enota_order_uq UNIQUE (enota_id, sort_order);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_group_prices_price_check') THEN
    ALTER TABLE malica_group_prices ADD CONSTRAINT malica_group_prices_price_check
      CHECK (price_cents >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_group_prices_status_check') THEN
    ALTER TABLE malica_group_prices ADD CONSTRAINT malica_group_prices_status_check
      CHECK (status IN ('draft', 'scheduled', 'active', 'past')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_group_prices_dates_check') THEN
    ALTER TABLE malica_group_prices ADD CONSTRAINT malica_group_prices_dates_check
      CHECK (valid_to IS NULL OR valid_to > valid_from) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_article_assignments_role_check') THEN
    ALTER TABLE malica_article_assignments ADD CONSTRAINT malica_article_assignments_role_check
      CHECK (role IN ('none', 'main', 'soup', 'dessert')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_article_assignments_price_check') THEN
    ALTER TABLE malica_article_assignments ADD CONSTRAINT malica_article_assignments_price_check
      CHECK (malica_price_cents IS NULL OR malica_price_cents >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_article_assignments_role_group_check') THEN
    ALTER TABLE malica_article_assignments ADD CONSTRAINT malica_article_assignments_role_group_check
      CHECK ((role = 'main' AND group_id IS NOT NULL) OR (role <> 'main' AND group_id IS NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_article_assignments_unit_article_uq') THEN
    ALTER TABLE malica_article_assignments ADD CONSTRAINT malica_article_assignments_unit_article_uq
      UNIQUE (enota_id, artikel_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_daily_offers_status_check') THEN
    ALTER TABLE malica_daily_offers ADD CONSTRAINT malica_daily_offers_status_check
      CHECK (status IN ('draft', 'published', 'closed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_daily_offers_version_check') THEN
    ALTER TABLE malica_daily_offers ADD CONSTRAINT malica_daily_offers_version_check
      CHECK (version > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_daily_offers_unit_date_version_uq') THEN
    ALTER TABLE malica_daily_offers ADD CONSTRAINT malica_daily_offers_unit_date_version_uq
      UNIQUE (enota_id, business_date, version);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_daily_main_items_price_check') THEN
    ALTER TABLE malica_daily_main_items ADD CONSTRAINT malica_daily_main_items_price_check
      CHECK (price_cents_snapshot >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_daily_main_items_offer_article_uq') THEN
    ALTER TABLE malica_daily_main_items ADD CONSTRAINT malica_daily_main_items_offer_article_uq
      UNIQUE (offer_id, artikel_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_daily_courses_type_check') THEN
    ALTER TABLE malica_daily_included_courses ADD CONSTRAINT malica_daily_courses_type_check
      CHECK (course_type IN ('soup', 'dessert')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_daily_courses_quantity_check') THEN
    ALTER TABLE malica_daily_included_courses ADD CONSTRAINT malica_daily_courses_quantity_check
      CHECK (quantity >= 0 AND reserved_quantity >= 0 AND consumed_quantity >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_daily_courses_offer_type_article_uq') THEN
    ALTER TABLE malica_daily_included_courses ADD CONSTRAINT malica_daily_courses_offer_type_article_uq
      UNIQUE (offer_id, course_type, artikel_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_partner_group_prices_price_check') THEN
    ALTER TABLE malica_partner_group_prices ADD CONSTRAINT malica_partner_group_prices_price_check
      CHECK (price_cents >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_partner_group_prices_dates_check') THEN
    ALTER TABLE malica_partner_group_prices ADD CONSTRAINT malica_partner_group_prices_dates_check
      CHECK (valid_to IS NULL OR valid_to > valid_from) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_sale_snapshots_regular_price_check') THEN
    ALTER TABLE malica_sale_snapshots ADD CONSTRAINT malica_sale_snapshots_regular_price_check
      CHECK (regular_price_cents >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_sale_snapshots_actual_price_check') THEN
    ALTER TABLE malica_sale_snapshots ADD CONSTRAINT malica_sale_snapshots_actual_price_check
      CHECK (actual_price_cents >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_sale_snapshots_source_check') THEN
    ALTER TABLE malica_sale_snapshots ADD CONSTRAINT malica_sale_snapshots_source_check
      CHECK (price_source IN ('regular', 'partner')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_contracts_mode_check') THEN
    ALTER TABLE malica_contracts ADD CONSTRAINT malica_contracts_mode_check
      CHECK (mode IN ('partner_all', 'guest_reduced_price', 'partner_fixed_guest_remainder', 'split')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_contracts_split_kind_check') THEN
    ALTER TABLE malica_contracts ADD CONSTRAINT malica_contracts_split_kind_check
      CHECK (split_kind IS NULL OR split_kind IN ('fixed', 'percent')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_contracts_dates_check') THEN
    ALTER TABLE malica_contracts ADD CONSTRAINT malica_contracts_dates_check
      CHECK (valid_to IS NULL OR valid_to >= valid_from) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_contracts_version_uq') THEN
    ALTER TABLE malica_contracts ADD CONSTRAINT malica_contracts_version_uq
      UNIQUE (enota_id, partner_id, version);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_beneficiaries_identifier_type_check') THEN
    ALTER TABLE malica_beneficiaries ADD CONSTRAINT malica_beneficiaries_identifier_type_check
      CHECK (identifier_type IN ('pin', 'barcode', 'qr', 'nfc')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'malica_beneficiaries_lookup_uq') THEN
    ALTER TABLE malica_beneficiaries ADD CONSTRAINT malica_beneficiaries_lookup_uq
      UNIQUE (enota_id, identifier_type, identifier_hash);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_lunch_offers_status_check') THEN
    ALTER TABLE daily_lunch_offers ADD CONSTRAINT daily_lunch_offers_status_check
      CHECK (status IN ('draft', 'published', 'closed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_lunch_choices_role_check') THEN
    ALTER TABLE daily_lunch_offer_choices ADD CONSTRAINT daily_lunch_choices_role_check
      CHECK (role IN ('starter', 'soup', 'main', 'dessert')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_lunch_snapshots_mode_check') THEN
    ALTER TABLE daily_lunch_sale_snapshots ADD CONSTRAINT daily_lunch_snapshots_mode_check
      CHECK (mode IN ('three_course', 'four_course')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_lunch_offer_choices_unique') THEN
    ALTER TABLE daily_lunch_offer_choices ADD CONSTRAINT daily_lunch_offer_choices_unique
      UNIQUE (offer_id, role, artikel_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_lunch_sale_snapshots_postavka_unique') THEN
    ALTER TABLE daily_lunch_sale_snapshots ADD CONSTRAINT daily_lunch_sale_snapshots_postavka_unique
      UNIQUE (postavka_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_venue_profiles_size_check') THEN
    ALTER TABLE public_venue_profiles ADD CONSTRAINT public_venue_profiles_size_check
      CHECK (max_party_size BETWEEN 1 AND 100 AND slot_minutes BETWEEN 15 AND 240 AND slot_capacity > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_reservations_party_size_check') THEN
    ALTER TABLE public_reservations ADD CONSTRAINT public_reservations_party_size_check
      CHECK (party_size > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_reservations_status_check') THEN
    ALTER TABLE public_reservations ADD CONSTRAINT public_reservations_status_check
      CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_voucher_variants_amount_check') THEN
    ALTER TABLE public_voucher_variants ADD CONSTRAINT public_voucher_variants_amount_check
      CHECK (amount_cents > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_voucher_variants_currency_check') THEN
    ALTER TABLE public_voucher_variants ADD CONSTRAINT public_voucher_variants_currency_check
      CHECK (currency = 'EUR') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'individual_vouchers_amount_check') THEN
    ALTER TABLE individual_vouchers ADD CONSTRAINT individual_vouchers_amount_check
      CHECK (initial_amount_cents > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'individual_voucher_movements_type_check') THEN
    ALTER TABLE individual_voucher_movements ADD CONSTRAINT individual_voucher_movements_type_check
      CHECK (type IN ('issue', 'redeem', 'reverse')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'individual_voucher_movements_amount_check') THEN
    ALTER TABLE individual_voucher_movements ADD CONSTRAINT individual_voucher_movements_amount_check
      CHECK (amount_cents > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_stripe_payment_review_audit_action_check') THEN
    ALTER TABLE public_stripe_payment_review_audit ADD CONSTRAINT public_stripe_payment_review_audit_action_check
      CHECK (action IN ('created', 'resolved')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stripe_connection_alerts_status_check') THEN
    ALTER TABLE stripe_connection_alerts ADD CONSTRAINT stripe_connection_alerts_status_check
      CHECK (status IN ('open', 'resolved')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stripe_connection_alerts_occurrence_check') THEN
    ALTER TABLE stripe_connection_alerts ADD CONSTRAINT stripe_connection_alerts_occurrence_check
      CHECK (occurrence_count >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stripe_connection_alerts_resolution_check') THEN
    ALTER TABLE stripe_connection_alerts ADD CONSTRAINT stripe_connection_alerts_resolution_check
      CHECK ((status = 'open' AND resolved_at IS NULL) OR
             (status = 'resolved' AND resolved_at IS NOT NULL)) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_malica_group_prices_lookup
  ON malica_group_prices(enota_id, group_id, valid_from);
CREATE INDEX IF NOT EXISTS ix_malica_article_assignments_role
  ON malica_article_assignments(enota_id, role, group_id);
CREATE INDEX IF NOT EXISTS ix_malica_daily_offers_unit_date
  ON malica_daily_offers(enota_id, business_date);
CREATE INDEX IF NOT EXISTS ix_malica_daily_main_items_offer_group
  ON malica_daily_main_items(offer_id, group_id);
CREATE INDEX IF NOT EXISTS ix_malica_daily_courses_offer_type
  ON malica_daily_included_courses(offer_id, course_type);
CREATE INDEX IF NOT EXISTS ix_malica_partner_group_prices_lookup
  ON malica_partner_group_prices(enota_id, kupec_id, group_id);
CREATE INDEX IF NOT EXISTS ix_postavke_live_malica_package
  ON postavke (narocilo_id, pairing_group_id, package_status)
  WHERE pairing_group_id LIKE 'malica:%';
CREATE INDEX IF NOT EXISTS ix_individual_vouchers_delivery_retry
  ON individual_vouchers (delivery_next_attempt_at, checkout_id)
  WHERE delivery_status IN ('pending', 'failed', 'sending');
CREATE INDEX IF NOT EXISTS ix_voucher_delivery_alerts_open_company
  ON voucher_delivery_alerts (company_id, unit_id, created_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_public_stripe_payment_review_audit_review
  ON public_stripe_payment_review_audit (review_id, created_at);

-- Accounting facts are immutable in every state, including partially created
-- tables.  CREATE OR REPLACE makes reruns converge the function body.
CREATE OR REPLACE FUNCTION malica_immutable_fact_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Malica accounting facts are immutable';
END $$;
DROP TRIGGER IF EXISTS malica_sale_snapshots_immutable ON malica_sale_snapshots;
CREATE TRIGGER malica_sale_snapshots_immutable
  BEFORE UPDATE OR DELETE ON malica_sale_snapshots FOR EACH ROW
  EXECUTE FUNCTION malica_immutable_fact_guard();
DROP TRIGGER IF EXISTS malica_allocations_immutable ON malica_allocations;
CREATE TRIGGER malica_allocations_immutable
  BEFORE UPDATE OR DELETE ON malica_allocations FOR EACH ROW
  EXECUTE FUNCTION malica_immutable_fact_guard();
DROP TRIGGER IF EXISTS malica_contract_usage_immutable ON malica_contract_usage;
CREATE TRIGGER malica_contract_usage_immutable
  BEFORE UPDATE OR DELETE ON malica_contract_usage FOR EACH ROW
  EXECUTE FUNCTION malica_immutable_fact_guard();