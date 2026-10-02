-- test-bootstrap: schema
-- Audit and release terminal instructions without mutating payment allocations or XML evidence.
ALTER TABLE payment_batch_items
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS resolution_reason text,
  ADD COLUMN IF NOT EXISTS resolved_by text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

ALTER TABLE payment_batch_items
  DROP CONSTRAINT IF EXISTS payment_batch_items_lifecycle_check;
ALTER TABLE payment_batch_items
  ADD CONSTRAINT payment_batch_items_lifecycle_check
  CHECK (lifecycle_status IN ('ready', 'partially_executed', 'executed', 'rejected', 'cancelled'));

DROP INDEX IF EXISTS payment_batch_items_payment_uq;
CREATE UNIQUE INDEX IF NOT EXISTS payment_batch_items_active_payment_uq
  ON payment_batch_items(payment_id)
  WHERE released_at IS NULL;