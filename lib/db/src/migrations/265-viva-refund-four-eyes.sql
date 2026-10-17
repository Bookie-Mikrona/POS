-- test-bootstrap: integrity
ALTER TABLE enote ADD COLUMN IF NOT EXISTS viva_refund_approval_threshold numeric(10,2) NOT NULL DEFAULT 100;
ALTER TABLE viva_vracila
  ADD COLUMN IF NOT EXISTS predlagani_status text,
  ADD COLUMN IF NOT EXISTS prvi_odobritelj_clerk_user_id text;
ALTER TABLE viva_vracilo_status_prehodi
  ADD COLUMN IF NOT EXISTS predlagani_status text;

ALTER TABLE viva_vracilo_status_prehodi
  DROP CONSTRAINT IF EXISTS viva_vracilo_status_prehodi_prejsnji_status_check,
  DROP CONSTRAINT IF EXISTS viva_vracilo_status_prehodi_novi_status_check;
ALTER TABLE viva_vracilo_status_prehodi
  ADD CONSTRAINT viva_vracilo_status_prehodi_prejsnji_status_check
    CHECK (prejsnji_status IS NULL OR prejsnji_status IN ('pending','unknown','awaiting_approval','paid','failed')),
  ADD CONSTRAINT viva_vracilo_status_prehodi_novi_status_check
    CHECK (novi_status IN ('pending','unknown','awaiting_approval','paid','failed'));

CREATE OR REPLACE FUNCTION protect_viva_manual_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.vir = 'manual' THEN
    RAISE EXCEPTION 'Manual refund decisions are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS viva_manual_decision_append_only ON viva_vracilo_status_prehodi;
CREATE TRIGGER viva_manual_decision_append_only
  BEFORE UPDATE OR DELETE ON viva_vracilo_status_prehodi
  FOR EACH ROW EXECUTE FUNCTION protect_viva_manual_decision();
