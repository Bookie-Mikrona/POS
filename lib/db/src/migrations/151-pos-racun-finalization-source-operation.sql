BEGIN;

ALTER TABLE pos_racun_finalization_plans
  ADD COLUMN IF NOT EXISTS source_operation_id text;

DROP TRIGGER IF EXISTS pos_racun_finalization_plans_immutable
  ON pos_racun_finalization_plans;

UPDATE pos_racun_finalization_plans
SET source_operation_id = COALESCE(
  NULLIF(plan->>'sourceOperationId', ''),
  'legacy-racun:' || racun_id::text
)
WHERE source_operation_id IS NULL;

ALTER TABLE pos_racun_finalization_plans
  ALTER COLUMN source_operation_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pos_racun_finalization_plans_source_operation_unique
  ON pos_racun_finalization_plans(company_id, source_operation_id);

CREATE TRIGGER pos_racun_finalization_plans_immutable
BEFORE UPDATE OR DELETE ON pos_racun_finalization_plans
FOR EACH ROW EXECUTE FUNCTION prevent_racun_finalization_plan_mutation();

COMMIT;