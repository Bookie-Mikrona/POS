BEGIN;

-- A legal offline receipt is immutable and may be finalized exactly once.  FURS
-- transport is deliberately modelled separately: an ambiguous delivery is a new
-- signed transport attempt, never a replay of a previous MessageID/XML blob.
CREATE TABLE IF NOT EXISTS offline_furs_transport_attempts (
  id uuid PRIMARY KEY,
  offline_receipt_id uuid NOT NULL REFERENCES offline_fiscal_receipts(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  message_id uuid NOT NULL,
  invoice_request_id text NOT NULL,
  signed_xml_base64 text NOT NULL,
  signed_xml_sha256 text NOT NULL CHECK (signed_xml_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  certificate_fingerprint text NOT NULL CHECK (certificate_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('allocated','sending','confirmed','retry_scheduled','failed','review')),
  eor text,
  response_body text,
  error_code text,
  sent_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(offline_receipt_id, attempt_no),
  UNIQUE(message_id),
  UNIQUE(invoice_request_id),
  UNIQUE(signed_xml_sha256)
);
CREATE INDEX IF NOT EXISTS offline_furs_transport_attempts_receipt_idx
  ON offline_furs_transport_attempts(offline_receipt_id, attempt_no DESC);

CREATE TABLE IF NOT EXISTS offline_furs_transport_events (
  id bigserial PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES offline_furs_transport_attempts(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('allocated','sent','response','timeout','network_error','retry_scheduled','validation_error','confirmed','review')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS offline_furs_transport_events_attempt_idx
  ON offline_furs_transport_events(attempt_id, id);

CREATE OR REPLACE FUNCTION prevent_offline_furs_transport_attempt_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'offline FURS transport attempts are append-only'; END IF;
  IF ROW(NEW.offline_receipt_id, NEW.attempt_no, NEW.message_id, NEW.invoice_request_id,
         NEW.signed_xml_base64, NEW.signed_xml_sha256, NEW.certificate_fingerprint)
     IS DISTINCT FROM
     ROW(OLD.offline_receipt_id, OLD.attempt_no, OLD.message_id, OLD.invoice_request_id,
         OLD.signed_xml_base64, OLD.signed_xml_sha256, OLD.certificate_fingerprint) THEN
    RAISE EXCEPTION 'offline FURS transport attempt legal transport evidence is immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS offline_furs_transport_attempts_immutable ON offline_furs_transport_attempts;
CREATE TRIGGER offline_furs_transport_attempts_immutable
  BEFORE UPDATE OR DELETE ON offline_furs_transport_attempts
  FOR EACH ROW EXECUTE FUNCTION prevent_offline_furs_transport_attempt_mutation();

-- The old one-shot artifact columns remain legal evidence for existing receipts,
-- but the worker below migration 155 must never use them to transmit again.
COMMIT;