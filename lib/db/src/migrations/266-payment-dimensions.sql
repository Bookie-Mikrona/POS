-- test-bootstrap: schema
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS bank_cost_center_id uuid REFERENCES cost_centers(id),
  ADD COLUMN IF NOT EXISTS bank_project_id uuid REFERENCES projects(id),
  ADD COLUMN IF NOT EXISTS counter_cost_center_id uuid REFERENCES cost_centers(id),
  ADD COLUMN IF NOT EXISTS counter_project_id uuid REFERENCES projects(id);
