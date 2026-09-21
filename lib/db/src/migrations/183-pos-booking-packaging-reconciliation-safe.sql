-- test-bootstrap: audit
ALTER TABLE pos_receipt_booking_sources
  ADD COLUMN IF NOT EXISTS packaging_reconciliation_safe boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN pos_receipt_booking_sources.packaging_reconciliation_safe IS
  'Immutable evidence that the booking preview excluded DOBROPIS returnable-packaging lines; false keeps historical bookings blocked from later reconciliation.';