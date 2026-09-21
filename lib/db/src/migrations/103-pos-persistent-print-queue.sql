-- Durable, leased POS printer queue.  All additions are nullable/defaulted so
-- installations which still contain the original delete-on-ack rows continue
-- to work.
ALTER TABLE tiskalne_naloge
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'receipt',
  ADD COLUMN IF NOT EXISTS destination text NOT NULL DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS printer_key text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS ack_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payload_hash text;

-- Old rows predate idempotency and are deliberately left with a NULL key.
CREATE UNIQUE INDEX IF NOT EXISTS tiskalne_naloge_idempotency_key_uq
  ON tiskalne_naloge (enota_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS tiskalne_naloge_claim_idx
  ON tiskalne_naloge (enota_id, destination, status, available_at, id);
CREATE INDEX IF NOT EXISTS tiskalne_naloge_lease_idx
  ON tiskalne_naloge (enota_id, status, lease_until)
  WHERE status = 'running';

ALTER TABLE tiskalne_naloge DROP CONSTRAINT IF EXISTS tiskalne_naloge_status_check;
ALTER TABLE tiskalne_naloge ADD CONSTRAINT tiskalne_naloge_status_check
  CHECK (status IN ('queued', 'running', 'printed', 'failed', 'needs_review'));

CREATE TABLE IF NOT EXISTS pos_printer_heartbeats (
  enota_id integer NOT NULL,
  printer_key text NOT NULL,
  agent_id text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (enota_id, printer_key)
);