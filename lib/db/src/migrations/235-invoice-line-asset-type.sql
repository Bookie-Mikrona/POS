-- test-bootstrap: schema
-- Razvrstitev osnovnega sredstva mora preživeti od potrjenega računa do KPR.
ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS asset_type text NOT NULL DEFAULT 'NONE';

ALTER TABLE invoice_lines
  DROP CONSTRAINT IF EXISTS invoice_lines_asset_type_check;
ALTER TABLE invoice_lines
  ADD CONSTRAINT invoice_lines_asset_type_check
  CHECK (asset_type IN ('NONE', 'OTHER_FA', 'REALESTATE'));