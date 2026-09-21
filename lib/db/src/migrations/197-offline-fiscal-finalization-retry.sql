-- test-bootstrap: schema
-- Durable retry state for business finalization after a confirmed FURS response.
ALTER TABLE offline_fiscal_receipts
  ADD COLUMN IF NOT EXISTS finalization_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalization_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalization_last_error text;