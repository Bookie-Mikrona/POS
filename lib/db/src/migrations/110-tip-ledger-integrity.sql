-- Policy scope: a unit policy is more specific than a global policy, and never
-- truncates it.  Ranges may overlap only across those distinct scopes.
CREATE EXTENSION IF NOT EXISTS btree_gist;
DROP INDEX IF EXISTS tip_policies_company_effective_from_unique;
CREATE UNIQUE INDEX IF NOT EXISTS tip_policies_company_scope_effective_from_unique
  ON tip_policies(company_id, COALESCE(enota_id, -1), effective_from);
ALTER TABLE tip_policies DROP CONSTRAINT IF EXISTS tip_policies_scope_no_overlap;
ALTER TABLE tip_policies ADD CONSTRAINT tip_policies_scope_no_overlap EXCLUDE USING gist (
  company_id WITH =, COALESCE(enota_id, -1) WITH =,
  daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
);

-- A pool is authorised by one independent-pool policy and an employee decision,
-- not by a unilateral internal rule.
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS tip_policy_id uuid REFERENCES tip_policies(id) ON DELETE RESTRICT;
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS decision_date date;
ALTER TABLE tip_pools DROP CONSTRAINT IF EXISTS tip_pools_decision_type_check;
ALTER TABLE tip_pools ADD CONSTRAINT tip_pools_decision_type_check CHECK (decision_type IN ('employee_agreement','collective_agreement')) NOT VALID;
ALTER TABLE tip_pools DROP CONSTRAINT IF EXISTS tip_pools_policy_required;
ALTER TABLE tip_pools ADD CONSTRAINT tip_pools_policy_required CHECK (tip_policy_id IS NOT NULL AND decision_date IS NOT NULL) NOT VALID;
CREATE UNIQUE INDEX IF NOT EXISTS tip_pool_entries_one_reversal
  ON tip_pool_entries(reversal_of_id) WHERE reversal_of_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tip_settlement_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  allocation_id uuid NOT NULL REFERENCES tip_allocations(id) ON DELETE RESTRICT,
  settlement_id uuid NOT NULL REFERENCES tip_settlements(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  evidence_reference text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(settlement_id)
);

CREATE TABLE IF NOT EXISTS z_tip_breakdown_corrections (
  id serial PRIMARY KEY,
  z_porocilo_id integer NOT NULL REFERENCES z_porocila(id) ON DELETE RESTRICT,
  previous_breakdown jsonb NOT NULL,
  replacement_breakdown jsonb NOT NULL,
  reason text NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS z_tip_breakdown_corrections_z_idx
  ON z_tip_breakdown_corrections(z_porocilo_id, created_at);

CREATE OR REPLACE FUNCTION tip_immutable_pool_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'tip_pool_entries are append-only'; END $$;
CREATE OR REPLACE FUNCTION tip_immutable_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'tip_settlements are immutable; use settlement recovery'; END $$;
CREATE OR REPLACE FUNCTION tip_pool_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'tip pool decision evidence is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tip_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'tip allocations cannot be deleted'; END IF;
  IF OLD.status <> 'open' AND (NEW.gross_amount, NEW.fee_amount, NEW.net_amount, NEW.tip_pool_id, NEW.tip_policy_id, NEW.racun_id)
       IS DISTINCT FROM (OLD.gross_amount, OLD.fee_amount, OLD.net_amount, OLD.tip_pool_id, OLD.tip_policy_id, OLD.racun_id)
  THEN RAISE EXCEPTION 'finalized allocation economic fields are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tip_historical_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.state = 'confirmed' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'confirmed historical review is immutable';
  END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tip_policy_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.id, NEW.company_id, NEW.enota_id, NEW.effective_from, NEW.mode, NEW.evidence_type, NEW.evidence_reference,
           NEW.agreement_confirmed, NEW.card_fee_treatment, NEW.card_fee_kind, NEW.card_fee_percent, NEW.card_fee_flat_amount, NEW.notes, NEW.created_by, NEW.created_at)
        IS NOT DISTINCT FROM
         (OLD.id, OLD.company_id, OLD.enota_id, OLD.effective_from, OLD.mode, OLD.evidence_type, OLD.evidence_reference,
           OLD.agreement_confirmed, OLD.card_fee_treatment, OLD.card_fee_kind, OLD.card_fee_percent, OLD.card_fee_flat_amount, OLD.notes, OLD.created_by, OLD.created_at)
  THEN
    IF NEW.effective_to IS NULL
       OR NEW.effective_to < OLD.effective_from
       OR (OLD.effective_to IS NOT NULL AND NEW.effective_to > OLD.effective_to) THEN
      RAISE EXCEPTION 'used policy may only be closed or shortened forward';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM racuni
      WHERE tip_policy_id = OLD.id
        AND (COALESCE(datum_cas, ustvarjeno) AT TIME ZONE 'Europe/Ljubljana')::date > NEW.effective_to
    ) THEN
      RAISE EXCEPTION 'policy cannot end before its latest receipt snapshot';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM tip_allocations WHERE tip_policy_id = OLD.id)
     OR EXISTS (SELECT 1 FROM racuni WHERE tip_policy_id = OLD.id)
     OR EXISTS (SELECT 1 FROM tip_pools WHERE tip_policy_id = OLD.id) THEN
    RAISE EXCEPTION 'policy evidence used by a receipt/allocation/pool is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tip_receipt_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.tip_policy_id, OLD.tip_policy_mode, OLD.tip_vat_amount, OLD.tip_card_fee_treatment,
      OLD.tip_card_fee_kind, OLD.tip_card_fee_tax_treatment, OLD.tip_card_fee_amount, OLD.tip_card_fee_flat_amount)
     IS DISTINCT FROM
     (NEW.tip_policy_id, NEW.tip_policy_mode, NEW.tip_vat_amount, NEW.tip_card_fee_treatment,
      NEW.tip_card_fee_kind, NEW.tip_card_fee_tax_treatment, NEW.tip_card_fee_amount, NEW.tip_card_fee_flat_amount)
  THEN RAISE EXCEPTION 'receipt tip snapshots are immutable after insert'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION z_tip_breakdown_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  correction_reason text;
  correction_actor text;
BEGIN
  IF OLD.tip_breakdown IS DISTINCT FROM NEW.tip_breakdown THEN
    IF OLD.odklenjen_ob IS NULL THEN
      RAISE EXCEPTION 'closed Z report tip breakdown is immutable';
    END IF;
    SELECT razlog, odklenil_uporabnik
      INTO correction_reason, correction_actor
      FROM z_porocilo_odklepi
      WHERE z_porocilo_id = OLD.id AND gt_po_ponovnem IS NULL
      ORDER BY id DESC
      LIMIT 1;
    IF correction_reason IS NULL OR correction_actor IS NULL THEN
      RAISE EXCEPTION 'Z tip correction requires an open unlock record';
    END IF;
    INSERT INTO z_tip_breakdown_corrections (
      z_porocilo_id, previous_breakdown, replacement_breakdown, reason, actor_id
    ) VALUES (
      OLD.id, OLD.tip_breakdown, NEW.tip_breakdown, correction_reason, correction_actor
    );
  END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION z_tip_correction_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Z tip breakdown corrections are append-only'; END $$;
DROP TRIGGER IF EXISTS tip_pool_entries_no_update ON tip_pool_entries;
CREATE TRIGGER tip_pool_entries_no_update BEFORE UPDATE OR DELETE ON tip_pool_entries FOR EACH ROW EXECUTE FUNCTION tip_immutable_pool_entry();
DROP TRIGGER IF EXISTS tip_settlements_no_update ON tip_settlements;
CREATE TRIGGER tip_settlements_no_update BEFORE UPDATE OR DELETE ON tip_settlements FOR EACH ROW EXECUTE FUNCTION tip_immutable_settlement();
DROP TRIGGER IF EXISTS tip_pools_history_guard ON tip_pools;
CREATE TRIGGER tip_pools_history_guard BEFORE UPDATE OR DELETE ON tip_pools FOR EACH ROW EXECUTE FUNCTION tip_pool_history_guard();
DROP TRIGGER IF EXISTS tip_allocations_guard ON tip_allocations;
CREATE TRIGGER tip_allocations_guard BEFORE UPDATE OR DELETE ON tip_allocations FOR EACH ROW EXECUTE FUNCTION tip_allocation_guard();
DROP TRIGGER IF EXISTS tip_historical_reviews_guard ON tip_historical_reviews;
CREATE TRIGGER tip_historical_reviews_guard BEFORE UPDATE OR DELETE ON tip_historical_reviews FOR EACH ROW EXECUTE FUNCTION tip_historical_review_guard();
DROP TRIGGER IF EXISTS tip_policies_history_guard ON tip_policies;
CREATE TRIGGER tip_policies_history_guard BEFORE UPDATE OR DELETE ON tip_policies FOR EACH ROW EXECUTE FUNCTION tip_policy_history_guard();
DROP TRIGGER IF EXISTS racuni_tip_snapshot_guard ON racuni;
CREATE TRIGGER racuni_tip_snapshot_guard BEFORE UPDATE ON racuni FOR EACH ROW EXECUTE FUNCTION tip_receipt_snapshot_guard();
DROP TRIGGER IF EXISTS z_porocila_tip_breakdown_guard ON z_porocila;
CREATE TRIGGER z_porocila_tip_breakdown_guard BEFORE UPDATE ON z_porocila FOR EACH ROW EXECUTE FUNCTION z_tip_breakdown_guard();
DROP TRIGGER IF EXISTS z_tip_breakdown_corrections_no_update ON z_tip_breakdown_corrections;
CREATE TRIGGER z_tip_breakdown_corrections_no_update BEFORE UPDATE OR DELETE ON z_tip_breakdown_corrections FOR EACH ROW EXECUTE FUNCTION z_tip_correction_immutable();