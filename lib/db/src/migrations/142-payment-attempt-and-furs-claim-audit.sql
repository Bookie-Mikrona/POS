-- Keep Bookie's business lifecycle distinct from every provider's own status.
ALTER TABLE pos_karticna_placila_attempt
  ADD COLUMN IF NOT EXISTS provider_raw_status text,
  ADD COLUMN IF NOT EXISTS actor text,
  ADD COLUMN IF NOT EXISTS device_key text;

-- Batch claim identity and a lease make concurrent retry workers observable and
-- ensure a crashed worker can be reconciled as unknown rather than retried.
ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS furs_claim_batch_id uuid,
  ADD COLUMN IF NOT EXISTS furs_claim_lease_until timestamptz;

CREATE INDEX IF NOT EXISTS racuni_furs_batch_claim_idx
  ON racuni (enota_id, furs_state, furs_claim_lease_until, ustvarjeno)
  WHERE request_hash IS NOT NULL;