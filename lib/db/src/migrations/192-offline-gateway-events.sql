-- test-bootstrap: schema
CREATE TABLE IF NOT EXISTS offline_gateway_events (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES offline_fiscal_devices(id) ON DELETE RESTRICT,
  gateway_seq integer NOT NULL,
  operation_id text NOT NULL,
  event_type text NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'accepted',
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offline_gateway_events_state_check CHECK (state IN ('accepted', 'needs_review'))
);
CREATE UNIQUE INDEX IF NOT EXISTS offline_gateway_events_device_seq
  ON offline_gateway_events(device_id, gateway_seq);
CREATE UNIQUE INDEX IF NOT EXISTS offline_gateway_events_device_operation
  ON offline_gateway_events(device_id, operation_id);