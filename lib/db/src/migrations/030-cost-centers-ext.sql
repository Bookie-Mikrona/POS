-- 030: Razširitev cost_centers z novimi polji
-- tip: direktna | indirektna | projektna (nullable)
-- parent_id: FK self (hierarhija, nullable)
-- odgovorna_oseba: varchar (nullable)
-- Obstoječi zapisi ostanejo nespremenjeni (aktiven=true že obstaja, ostalo NULL)

ALTER TABLE cost_centers
  ADD COLUMN IF NOT EXISTS tip          text       CHECK (tip IN ('direktna', 'indirektna', 'projektna')),
  ADD COLUMN IF NOT EXISTS parent_id    uuid       REFERENCES cost_centers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS odgovorna_oseba text;

CREATE INDEX IF NOT EXISTS ix_cost_centers_parent ON cost_centers(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cost_centers_company_active ON cost_centers(company_id, is_active);
