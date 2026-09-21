-- test-bootstrap: schema
-- Idempotent tripoložajna politika stroškovnega mesta za konte.
DO $$
BEGIN
  CREATE TYPE account_cost_center_policy AS ENUM ('not_allowed', 'allowed', 'required');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'accounts'
      AND column_name = 'cost_center_policy'
  ) THEN
    ALTER TABLE accounts
      ADD COLUMN cost_center_policy account_cost_center_policy NOT NULL DEFAULT 'allowed';

    -- Backfill se izvede samo ob prvem dodajanju stolpca. Ponovni zagon
    -- migracije zato ne prepiše poznejših ročnih nastavitev kontov.
    UPDATE accounts
    SET cost_center_policy = CASE
      WHEN requires_cost_center THEN 'required'::account_cost_center_policy
      WHEN left(trim(code), 1) = '4' THEN 'required'::account_cost_center_policy
      WHEN left(trim(code), 1) IN ('1', '2', '9') THEN 'not_allowed'::account_cost_center_policy
      ELSE 'allowed'::account_cost_center_policy
    END;

    UPDATE accounts
    SET requires_cost_center = (cost_center_policy = 'required');
  END IF;
END $$;