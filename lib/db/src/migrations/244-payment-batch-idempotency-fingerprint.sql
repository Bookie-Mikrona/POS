-- test-bootstrap: schema
-- Canonical idempotency identity for both direct allocation creation and draft packaging.
ALTER TABLE payment_batches
  ADD COLUMN IF NOT EXISTS request_fingerprint text;