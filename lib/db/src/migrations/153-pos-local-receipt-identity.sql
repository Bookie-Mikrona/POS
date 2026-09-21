BEGIN;

ALTER TABLE racuni ADD COLUMN IF NOT EXISTS local_receipt_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS racuni_local_receipt_id_unique ON racuni(local_receipt_id);

ALTER TABLE offline_fiscal_receipts ADD COLUMN IF NOT EXISTS local_receipt_id uuid;
UPDATE offline_fiscal_receipts
SET local_receipt_id = COALESCE((finalization_plan->'receipt'->>'localReceiptId')::uuid, operation_id)
WHERE local_receipt_id IS NULL;
ALTER TABLE offline_fiscal_receipts ALTER COLUMN local_receipt_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS offline_fiscal_receipts_local_receipt_unique
  ON offline_fiscal_receipts(local_receipt_id);

ALTER TABLE pos_racun_finalization_plans ADD COLUMN IF NOT EXISTS local_receipt_id uuid;
-- The plan trigger predates this migration.  Drop/recreate around the only
-- legitimate migration backfill so a rerun cannot be blocked by immutability.
DROP TRIGGER IF EXISTS pos_racun_finalization_plans_immutable ON pos_racun_finalization_plans;
UPDATE pos_racun_finalization_plans p
SET local_receipt_id = COALESCE(
  (p.plan->'receipt'->>'localReceiptId')::uuid,
  CASE WHEN p.source_operation_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       THEN p.source_operation_id::uuid ELSE p.id END
)
WHERE local_receipt_id IS NULL;
ALTER TABLE pos_racun_finalization_plans ALTER COLUMN local_receipt_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pos_racun_finalization_plans_local_receipt_unique
  ON pos_racun_finalization_plans(local_receipt_id);
CREATE TRIGGER pos_racun_finalization_plans_immutable
BEFORE UPDATE OR DELETE ON pos_racun_finalization_plans
FOR EACH ROW EXECUTE FUNCTION prevent_racun_finalization_plan_mutation();

UPDATE racuni r SET local_receipt_id = p.local_receipt_id
FROM pos_racun_finalization_plans p
WHERE p.racun_id = r.id AND r.local_receipt_id IS NULL;

COMMIT;