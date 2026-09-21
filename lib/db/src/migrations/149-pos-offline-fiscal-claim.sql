-- Crash-safe offline receipt import claim. The feature remains fail-closed:
-- production_enabled must be explicitly enabled only after contract/worker tests pass.
ALTER TABLE offline_fiscal_receipts
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS production_enabled boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS ux_offline_fiscal_receipts_racun
  ON offline_fiscal_receipts(racun_id) WHERE racun_id IS NOT NULL;

ALTER TABLE racuni ADD COLUMN IF NOT EXISTS offline_receipt_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ux_racuni_offline_receipt_id
  ON racuni(offline_receipt_id) WHERE offline_receipt_id IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE racuni ADD CONSTRAINT fk_racuni_offline_receipt
    FOREIGN KEY (offline_receipt_id) REFERENCES offline_fiscal_receipts(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE offline_fiscal_receipts ADD CONSTRAINT fk_offline_receipt_racun
    FOREIGN KEY (racun_id) REFERENCES racuni(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE offline_fiscal_receipts DROP CONSTRAINT IF EXISTS offline_fiscal_receipts_claim_check;
ALTER TABLE offline_fiscal_receipts ADD CONSTRAINT offline_fiscal_receipts_claim_check CHECK (
  (claim_token IS NULL AND claim_lease_until IS NULL) OR
  (claim_token IS NOT NULL AND claim_lease_until IS NOT NULL)
);