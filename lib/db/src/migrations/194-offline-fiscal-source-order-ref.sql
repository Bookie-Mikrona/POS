-- test-bootstrap: schema
-- Gateway-owned UUID fiscal receipts remain audit-only in cloud.
ALTER TABLE offline_fiscal_receipts
  ADD COLUMN IF NOT EXISTS source_order_ref text;