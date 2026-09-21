BEGIN;

ALTER TABLE offline_fiscal_receipts
  DROP CONSTRAINT IF EXISTS offline_fiscal_receipts_furs_state_check;
ALTER TABLE offline_fiscal_receipts
  ADD CONSTRAINT offline_fiscal_receipts_furs_state_check
  CHECK (furs_state IN ('received_pending_review','pending','sending','confirmed','failed','unknown','needs_review','quarantined'));

-- A conflicting late EOR preserves the first accepted EOR while requiring
-- operator review, so the legacy confirmed-only EOR invariant must include it.
ALTER TABLE offline_fiscal_receipts
  DROP CONSTRAINT IF EXISTS offline_fiscal_receipts_check;
ALTER TABLE offline_fiscal_receipts
  DROP CONSTRAINT IF EXISTS offline_fiscal_receipts_eor_state_check;
ALTER TABLE offline_fiscal_receipts
  ADD CONSTRAINT offline_fiscal_receipts_eor_state_check
  CHECK (eor IS NULL OR furs_state IN ('confirmed','needs_review'));

COMMIT;