-- test-bootstrap: schema
CREATE TABLE IF NOT EXISTS offline_gateway_sync_reviews (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES offline_fiscal_devices(id) ON DELETE RESTRICT,
  gateway_seq integer NOT NULL,
  operation_id text NOT NULL,
  existing_payload_hash text,
  incoming_payload_hash text NOT NULL,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offline_gateway_sync_reviews_device_state
  ON offline_gateway_sync_reviews (device_id, state);