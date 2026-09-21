CREATE TABLE IF NOT EXISTS offline_provisioning_challenges (
  id uuid PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  poslovni_prostor_id integer NOT NULL REFERENCES poslovni_prostori(id) ON DELETE RESTRICT,
  challenge text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offline_provisioning_bundles (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES offline_fiscal_devices(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  signature_base64 text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id, version),
  CHECK (version > 0 AND valid_until > valid_from)
);

CREATE TABLE IF NOT EXISTS offline_device_sync_nonces (
  device_id uuid NOT NULL REFERENCES offline_fiscal_devices(id) ON DELETE RESTRICT,
  nonce text NOT NULL,
  request_timestamp timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(device_id, nonce),
  CHECK (length(nonce) BETWEEN 22 AND 256)
);
CREATE INDEX IF NOT EXISTS offline_device_sync_nonces_expiry_idx ON offline_device_sync_nonces(expires_at);

CREATE OR REPLACE FUNCTION guard_offline_provisioning_bundle_immutable() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.device_id, NEW.version, NEW.payload, NEW.payload_sha256, NEW.signature_base64,
         NEW.valid_from, NEW.valid_until)
     IS DISTINCT FROM
     ROW(OLD.device_id, OLD.version, OLD.payload, OLD.payload_sha256, OLD.signature_base64,
         OLD.valid_from, OLD.valid_until) THEN
    RAISE EXCEPTION 'offline provisioning bundle is immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_offline_provisioning_bundle_immutable ON offline_provisioning_bundles;
CREATE TRIGGER trg_offline_provisioning_bundle_immutable
  BEFORE UPDATE ON offline_provisioning_bundles
  FOR EACH ROW EXECUTE FUNCTION guard_offline_provisioning_bundle_immutable();