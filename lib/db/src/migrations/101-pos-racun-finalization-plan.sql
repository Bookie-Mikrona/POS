CREATE TABLE IF NOT EXISTS pos_racun_finalization_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  racun_id integer NOT NULL REFERENCES racuni(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  plan jsonb NOT NULL,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_racun_finalization_plans_racun_unique
  ON pos_racun_finalization_plans(racun_id);

CREATE OR REPLACE FUNCTION prevent_racun_finalization_plan_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'receipt finalization plan is immutable';
END;
$$;

DROP TRIGGER IF EXISTS pos_racun_finalization_plans_immutable ON pos_racun_finalization_plans;
CREATE TRIGGER pos_racun_finalization_plans_immutable
BEFORE UPDATE OR DELETE ON pos_racun_finalization_plans
FOR EACH ROW EXECUTE FUNCTION prevent_racun_finalization_plan_mutation();