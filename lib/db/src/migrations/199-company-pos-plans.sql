-- test-bootstrap: schema
CREATE TABLE IF NOT EXISTS company_pos_plans (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'lite',
  enabled_at timestamptz NOT NULL DEFAULT now(),
  enabled_by text NOT NULL,
  CONSTRAINT company_pos_plans_plan_check
    CHECK (plan IN ('lite', 'standard', 'extended'))
);

INSERT INTO company_pos_plans (company_id, plan, enabled_by)
SELECT c.id, 'extended', 'migration-199'
FROM companies c
WHERE EXISTS (
  SELECT 1
  FROM company_modules cm
  WHERE cm.company_id = c.id
    AND cm.module = 'pos'
)
OR EXISTS (
  SELECT 1
  FROM enote e
  WHERE e.company_id = c.id
)
OR EXISTS (
  SELECT 1
  FROM pos_uporabniki pu
  WHERE pu.company_id = c.id
)
ON CONFLICT (company_id) DO NOTHING;