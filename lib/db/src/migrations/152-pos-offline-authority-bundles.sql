ALTER TABLE offline_fiscal_devices
  ADD COLUMN IF NOT EXISTS authority_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS offline_authority_bundles (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES offline_fiscal_devices(id) ON DELETE RESTRICT,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  authority_version integer NOT NULL,
  bundle_sha256 text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  key_id text NOT NULL,
  signature_base64 text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until > valid_from)
);
CREATE INDEX IF NOT EXISTS ix_offline_authority_bundles_device_validity
  ON offline_authority_bundles(device_id, valid_until) WHERE revoked_at IS NULL;

ALTER TABLE offline_fiscal_receipts
  ADD COLUMN IF NOT EXISTS authority_bundle_id uuid REFERENCES offline_authority_bundles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS authority_bundle_sha256 text;
CREATE INDEX IF NOT EXISTS ix_offline_receipts_authority_bundle
  ON offline_fiscal_receipts(authority_bundle_id);

CREATE OR REPLACE FUNCTION guard_offline_authority_binding_immutable() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.authority_bundle_id, NEW.authority_bundle_sha256)
     IS DISTINCT FROM ROW(OLD.authority_bundle_id, OLD.authority_bundle_sha256) THEN
    RAISE EXCEPTION 'offline authority bundle binding is immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_offline_authority_binding_immutable ON offline_fiscal_receipts;
CREATE TRIGGER trg_offline_authority_binding_immutable BEFORE UPDATE ON offline_fiscal_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_offline_authority_binding_immutable();

CREATE OR REPLACE FUNCTION guard_offline_authority_bundle_immutable() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.device_id, NEW.enota_id, NEW.authority_version, NEW.bundle_sha256, NEW.payload,
         NEW.key_id, NEW.signature_base64, NEW.valid_from, NEW.valid_until)
     IS DISTINCT FROM
     ROW(OLD.device_id, OLD.enota_id, OLD.authority_version, OLD.bundle_sha256, OLD.payload,
         OLD.key_id, OLD.signature_base64, OLD.valid_from, OLD.valid_until) THEN
    RAISE EXCEPTION 'offline authority bundle is immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_offline_authority_bundle_immutable ON offline_authority_bundles;
CREATE TRIGGER trg_offline_authority_bundle_immutable BEFORE UPDATE ON offline_authority_bundles
  FOR EACH ROW EXECUTE FUNCTION guard_offline_authority_bundle_immutable();