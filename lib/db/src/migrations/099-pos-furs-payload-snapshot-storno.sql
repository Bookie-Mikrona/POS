ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS storno_finalized_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS racuni_izvorni_storno_unique
  ON racuni (izvorni_racun_id)
  WHERE je_storno = true;

CREATE TABLE IF NOT EXISTS furs_payload_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  operation_key text NOT NULL,
  issue_reservation_id uuid REFERENCES pos_racun_izdaja_zahteve(id) ON DELETE RESTRICT,
  gift_reservation_id uuid REFERENCES darilni_bon_izdaje(id) ON DELETE RESTRICT,
  racun_id integer REFERENCES racuni(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  furs_nacin text NOT NULL CHECK (furs_nacin IN ('simulacija', 'testno', 'produkcija')),
  preskoci_preverjanje boolean NOT NULL DEFAULT false,
  splosna_stopnja numeric(5,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS furs_payload_snapshots_operation_unique
  ON furs_payload_snapshots(company_id, operation_key);
CREATE UNIQUE INDEX IF NOT EXISTS furs_payload_snapshots_issue_unique
  ON furs_payload_snapshots(issue_reservation_id);
CREATE UNIQUE INDEX IF NOT EXISTS furs_payload_snapshots_gift_unique
  ON furs_payload_snapshots(gift_reservation_id);
CREATE UNIQUE INDEX IF NOT EXISTS furs_payload_snapshots_racun_unique
  ON furs_payload_snapshots(racun_id);

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
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'FURS payload snapshot is immutable';
  END IF;
  IF OLD.racun_id IS NOT NULL AND NEW.racun_id IS DISTINCT FROM OLD.racun_id THEN
    RAISE EXCEPTION 'FURS payload snapshot receipt binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS furs_payload_snapshots_immutable ON furs_payload_snapshots;
CREATE TRIGGER furs_payload_snapshots_immutable
BEFORE UPDATE ON furs_payload_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_furs_snapshot_mutation();

CREATE OR REPLACE FUNCTION prevent_furs_snapshot_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FURS payload snapshot cannot be deleted';
END;
$$;

DROP TRIGGER IF EXISTS furs_payload_snapshots_no_delete ON furs_payload_snapshots;
CREATE TRIGGER furs_payload_snapshots_no_delete
BEFORE DELETE ON furs_payload_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_furs_snapshot_delete();