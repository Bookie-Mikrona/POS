ALTER TABLE offline_fiscal_devices
  ADD COLUMN IF NOT EXISTS expected_furs_cert_fingerprint text,
  ADD COLUMN IF NOT EXISTS contract_version text NOT NULL DEFAULT 'provisional',
  ADD COLUMN IF NOT EXISTS golden_attestation_sha256 text,
  ADD COLUMN IF NOT EXISTS production_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE offline_fiscal_receipts
  ADD COLUMN IF NOT EXISTS finalization_plan jsonb,
  ADD COLUMN IF NOT EXISTS finalization_plan_sha256 text,
  ADD COLUMN IF NOT EXISTS signed_furs_xml_base64 text,
  ADD COLUMN IF NOT EXISTS signed_furs_xml_sha256 text,
  ADD COLUMN IF NOT EXISTS furs_canonical_fields jsonb,
  ADD COLUMN IF NOT EXISTS furs_certificate_fingerprint text;

ALTER TABLE offline_fiscal_receipts DROP CONSTRAINT IF EXISTS offline_fiscal_receipts_furs_v1_check;
ALTER TABLE offline_fiscal_receipts ADD CONSTRAINT offline_fiscal_receipts_furs_v1_check CHECK (
  furs_state = 'quarantined' OR
  finalization_plan IS NULL OR
  canonical_payload->>'envelopeVersion' = 'furs-v2' OR
  (
    finalization_plan_sha256 IS NOT NULL AND
    signed_furs_xml_base64 IS NOT NULL AND
    signed_furs_xml_sha256 IS NOT NULL AND
    furs_canonical_fields IS NOT NULL AND
    furs_certificate_fingerprint IS NOT NULL
  )
);

CREATE OR REPLACE FUNCTION guard_offline_furs_v1_artifacts_immutable() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.finalization_plan, NEW.finalization_plan_sha256, NEW.signed_furs_xml_base64,
         NEW.signed_furs_xml_sha256, NEW.furs_canonical_fields, NEW.furs_certificate_fingerprint)
     IS DISTINCT FROM
     ROW(OLD.finalization_plan, OLD.finalization_plan_sha256, OLD.signed_furs_xml_base64,
         OLD.signed_furs_xml_sha256, OLD.furs_canonical_fields, OLD.furs_certificate_fingerprint) THEN
    RAISE EXCEPTION 'offline furs-v1 artifacts are immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_offline_furs_v1_artifacts_immutable ON offline_fiscal_receipts;
CREATE TRIGGER trg_offline_furs_v1_artifacts_immutable BEFORE UPDATE ON offline_fiscal_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_offline_furs_v1_artifacts_immutable();