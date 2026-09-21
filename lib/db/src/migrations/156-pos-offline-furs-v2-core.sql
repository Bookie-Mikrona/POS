BEGIN;

-- v2 stores only device-signed immutable legal evidence on the receipt.
-- Server-signed XML lives exclusively in offline_furs_transport_attempts.
ALTER TABLE offline_fiscal_receipts DROP CONSTRAINT IF EXISTS offline_fiscal_receipts_furs_v1_check;
ALTER TABLE offline_fiscal_receipts DROP CONSTRAINT IF EXISTS offline_fiscal_receipts_furs_v2_core_check;
-- Existing sealed v1 XML is retained as evidence but is terminally quarantined:
-- migration 155+ must never transmit it.
UPDATE offline_fiscal_receipts
SET furs_state = 'quarantined', claim_token = NULL, claim_lease_until = NULL,
    furs_last_error = COALESCE(furs_last_error, 'Legacy furs-v1 transport envelope is quarantine-only.')
WHERE finalization_plan IS NOT NULL
  AND COALESCE(canonical_payload->>'envelopeVersion', '') <> 'furs-v2'
  AND furs_state <> 'confirmed';
ALTER TABLE offline_fiscal_receipts ADD CONSTRAINT offline_fiscal_receipts_furs_v2_core_check CHECK (
  furs_state IN ('quarantined', 'confirmed') OR finalization_plan IS NULL OR
  (finalization_plan_sha256 IS NOT NULL AND canonical_payload->>'envelopeVersion' = 'furs-v2')
);

COMMIT;