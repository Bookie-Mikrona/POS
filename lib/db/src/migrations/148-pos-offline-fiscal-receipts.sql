-- Offline cash fiscalisation. Private signing keys live exclusively on the
-- registered Android/Windows service and are intentionally not represented.
CREATE TABLE IF NOT EXISTS offline_fiscal_devices (
  id uuid PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  poslovni_prostor_id integer NOT NULL REFERENCES poslovni_prostori(id) ON DELETE RESTRICT,
  b_identifier text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android', 'windows')),
  public_key_pem text NOT NULL,
  key_fingerprint_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'provisioned' CHECK (status IN ('provisioned', 'active', 'revoked')),
  provisioned_at timestamptz NOT NULL DEFAULT now(), activated_at timestamptz,
  revoked_at timestamptz, revoked_reason text, last_sequence integer NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enota_id, poslovni_prostor_id, b_identifier)
);

CREATE TABLE IF NOT EXISTS offline_fiscal_receipts (
  id uuid PRIMARY KEY, operation_id uuid NOT NULL UNIQUE,
  device_id uuid NOT NULL REFERENCES offline_fiscal_devices(id) ON DELETE RESTRICT,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  poslovni_prostor_id integer NOT NULL REFERENCES poslovni_prostori(id) ON DELETE RESTRICT,
  poslovni_prostor_oznaka text NOT NULL, b_identifier text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  canonical_payload jsonb NOT NULL, payload_sha256 text NOT NULL,
  device_signature text NOT NULL, signing_public_key_fingerprint_sha256 text NOT NULL,
  issued_at timestamptz NOT NULL, interruption_started_at timestamptz NOT NULL,
  submission_deadline_at timestamptz NOT NULL,
  operator_reference text, order_id integer REFERENCES narocila(id) ON DELETE RESTRICT,
  payment_reference text, payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method = 'cash'),
  zoi text NOT NULL, print_state text NOT NULL DEFAULT 'not_printed' CHECK (print_state IN ('not_printed','printed','failed')),
  furs_state text NOT NULL DEFAULT 'received_pending_review' CHECK (furs_state IN ('received_pending_review','pending','sending','confirmed','failed','unknown','quarantined')),
  eor text, furs_attempt_count integer NOT NULL DEFAULT 0, furs_last_error text,
  furs_last_attempt_at timestamptz, furs_confirmed_at timestamptz, racun_id integer,
  received_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enota_id, poslovni_prostor_oznaka, b_identifier, sequence),
  CHECK (eor IS NULL OR furs_state = 'confirmed'),
  CHECK (issued_at >= interruption_started_at)
);
CREATE INDEX IF NOT EXISTS ix_offline_fiscal_receipts_pending
  ON offline_fiscal_receipts (enota_id, furs_state, submission_deadline_at);

CREATE TABLE IF NOT EXISTS offline_fiscal_receipt_attempts (
  id serial PRIMARY KEY, receipt_id uuid NOT NULL REFERENCES offline_fiscal_receipts(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('ingested','submit','response_unknown','reconcile','quarantine')),
  outcome text NOT NULL CHECK (outcome IN ('accepted','confirmed','failed','unknown','rejected')),
  detail text, actor_reference text, created_at timestamptz NOT NULL DEFAULT now()
);

-- Legal envelope columns cannot be edited after the first insert. Operational
-- state remains mutable only for the controlled server sync workflow.
CREATE OR REPLACE FUNCTION guard_offline_fiscal_receipt_immutable() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.operation_id, NEW.device_id, NEW.enota_id, NEW.poslovni_prostor_id,
         NEW.poslovni_prostor_oznaka, NEW.b_identifier, NEW.sequence, NEW.canonical_payload,
         NEW.payload_sha256, NEW.device_signature, NEW.signing_public_key_fingerprint_sha256,
         NEW.issued_at, NEW.interruption_started_at, NEW.submission_deadline_at, NEW.operator_reference,
         NEW.order_id, NEW.payment_reference, NEW.payment_method, NEW.zoi)
     IS DISTINCT FROM
     ROW(OLD.operation_id, OLD.device_id, OLD.enota_id, OLD.poslovni_prostor_id,
         OLD.poslovni_prostor_oznaka, OLD.b_identifier, OLD.sequence, OLD.canonical_payload,
         OLD.payload_sha256, OLD.device_signature, OLD.signing_public_key_fingerprint_sha256,
         OLD.issued_at, OLD.interruption_started_at, OLD.submission_deadline_at, OLD.operator_reference,
         OLD.order_id, OLD.payment_reference, OLD.payment_method, OLD.zoi) THEN
    RAISE EXCEPTION 'offline fiscal receipt legal envelope is immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_offline_fiscal_receipt_immutable ON offline_fiscal_receipts;
CREATE TRIGGER trg_offline_fiscal_receipt_immutable BEFORE UPDATE ON offline_fiscal_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_offline_fiscal_receipt_immutable();

CREATE OR REPLACE FUNCTION deny_offline_fiscal_attempt_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'offline fiscal receipt attempts are append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_offline_fiscal_attempts_append_only ON offline_fiscal_receipt_attempts;
CREATE TRIGGER trg_offline_fiscal_attempts_append_only BEFORE UPDATE OR DELETE ON offline_fiscal_receipt_attempts
  FOR EACH ROW EXECUTE FUNCTION deny_offline_fiscal_attempt_mutation();