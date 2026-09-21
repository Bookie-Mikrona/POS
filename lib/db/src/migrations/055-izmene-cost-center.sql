-- 055-izmene-cost-center.sql
--
-- Snapshot stroškovnega mesta na POS izmeni. UUID je uporabljen zato, ker je
-- cost_centers.id UUID; enote.cost_center_id uporablja isti tip.
-- NULL ostane dovoljen za enote, ki še nimajo nastavljenega stroškovnega mesta.

ALTER TABLE izmene
  ADD COLUMN IF NOT EXISTS cost_center_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'izmene_cost_center_id_cost_centers_id_fk'
  ) THEN
    ALTER TABLE izmene
      ADD CONSTRAINT izmene_cost_center_id_cost_centers_id_fk
      FOREIGN KEY (cost_center_id)
      REFERENCES cost_centers(id)
      ON DELETE SET NULL;
  END IF;
END $$;