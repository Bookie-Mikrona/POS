ALTER TABLE furs_payload_snapshots
  ADD COLUMN IF NOT EXISTS signing_context_fingerprint text;

UPDATE furs_payload_snapshots
SET signing_context_fingerprint = CASE
  WHEN furs_nacin = 'simulacija' THEN 'simulation'
  ELSE 'legacy-manual'
END
WHERE signing_context_fingerprint IS NULL;

ALTER TABLE furs_payload_snapshots
  ALTER COLUMN signing_context_fingerprint SET DEFAULT 'legacy-manual',
  ALTER COLUMN signing_context_fingerprint SET NOT NULL;

ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS business_finalized_at timestamptz;

CREATE OR REPLACE FUNCTION prevent_furs_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.enota_id IS DISTINCT FROM OLD.enota_id
     OR NEW.operation_key IS DISTINCT FROM OLD.operation_key
     OR NEW.issue_reservation_id IS DISTINCT FROM OLD.issue_reservation_id
     OR NEW.gift_reservation_id IS DISTINCT FROM OLD.gift_reservation_id
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.furs_nacin IS DISTINCT FROM OLD.furs_nacin
     OR NEW.preskoci_preverjanje IS DISTINCT FROM OLD.preskoci_preverjanje
     OR NEW.splosna_stopnja IS DISTINCT FROM OLD.splosna_stopnja
     OR NEW.signing_context_fingerprint IS DISTINCT FROM OLD.signing_context_fingerprint
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'FURS payload snapshot is immutable';
  END IF;
  IF OLD.racun_id IS NOT NULL AND NEW.racun_id IS DISTINCT FROM OLD.racun_id THEN
    RAISE EXCEPTION 'FURS payload snapshot receipt binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;