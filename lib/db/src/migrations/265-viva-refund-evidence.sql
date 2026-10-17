-- test-bootstrap: integrity
CREATE TABLE IF NOT EXISTS viva_vracilo_dokazila (
  id text PRIMARY KEY,
  viva_vracilo_id integer NOT NULL REFERENCES viva_vracila(id),
  enota_id integer NOT NULL,
  priponka jsonb NOT NULL,
  actor_clerk_user_id text NOT NULL,
  ustvarjeno timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE viva_vracilo_status_prehodi ADD COLUMN IF NOT EXISTS dokaz_priponka jsonb;

CREATE OR REPLACE FUNCTION protect_viva_refund_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Refund evidence is immutable';
END;
$$;
DROP TRIGGER IF EXISTS immutable_viva_refund_evidence ON viva_vracilo_dokazila;
CREATE TRIGGER immutable_viva_refund_evidence BEFORE UPDATE OR DELETE ON viva_vracilo_dokazila
FOR EACH ROW EXECUTE FUNCTION protect_viva_refund_evidence();

CREATE OR REPLACE FUNCTION protect_viva_refund_audit_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.dokaz_priponka IS NOT NULL THEN
    RAISE EXCEPTION 'Refund evidence audit is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS immutable_viva_refund_audit_evidence ON viva_vracilo_status_prehodi;
CREATE TRIGGER immutable_viva_refund_audit_evidence BEFORE UPDATE OR DELETE ON viva_vracilo_status_prehodi
FOR EACH ROW EXECUTE FUNCTION protect_viva_refund_audit_evidence();
