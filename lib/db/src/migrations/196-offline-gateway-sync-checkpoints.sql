-- test-bootstrap: schema
-- Durable device stream checkpoints and manager-resolution evidence.
CREATE TABLE IF NOT EXISTS offline_gateway_sync_checkpoints (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES offline_fiscal_devices(id) ON DELETE RESTRICT,
  last_accepted_seq integer NOT NULL DEFAULT 0,
  last_resolved_seq integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS offline_gateway_sync_checkpoints_device
  ON offline_gateway_sync_checkpoints(device_id);
INSERT INTO offline_gateway_sync_checkpoints (id, device_id, last_accepted_seq, last_resolved_seq)
SELECT gen_random_uuid(), device_id, max(gateway_seq), max(gateway_seq)
FROM offline_gateway_events
WHERE state = 'accepted'
GROUP BY device_id
ON CONFLICT (device_id) DO NOTHING;

ALTER TABLE offline_gateway_sync_reviews
  ADD COLUMN IF NOT EXISTS resolution text,
  ADD COLUMN IF NOT EXISTS resolved_by text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_note text;