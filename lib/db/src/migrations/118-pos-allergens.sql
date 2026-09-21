-- Evidence-based direct allergen profiles and immutable POS receipt snapshots.
-- Defaults deliberately remain "nepreverjeno": [] never means confirmed absent.
ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS alergeni JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS alergeni_sledi JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS alergeni_status TEXT NOT NULL DEFAULT 'nepreverjeno',
  ADD COLUMN IF NOT EXISTS alergeni_vir TEXT,
  ADD COLUMN IF NOT EXISTS alergeni_opomba_vira TEXT,
  ADD COLUMN IF NOT EXISTS alergeni_document_id UUID REFERENCES documents(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS alergeni_verified_by TEXT,
  ADD COLUMN IF NOT EXISTS alergeni_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alergeni_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alergeni_hash TEXT;

ALTER TABLE artikli DROP CONSTRAINT IF EXISTS artikli_alergeni_status_check;
ALTER TABLE artikli ADD CONSTRAINT artikli_alergeni_status_check
  CHECK (alergeni_status IN ('nepreverjeno', 'potrjeno_brez', 'potrjeno'));
ALTER TABLE artikli DROP CONSTRAINT IF EXISTS artikli_alergeni_vir_check;
ALTER TABLE artikli ADD CONSTRAINT artikli_alergeni_vir_check
  CHECK (alergeni_vir IS NULL OR alergeni_vir IN ('etiketa', 'specifikacija', 'izjava_dobavitelja', 'normativ', 'rocno', 'drugo'));

ALTER TABLE prejemnice_postavke
  ADD COLUMN IF NOT EXISTS alergeni JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS alergeni_sledi JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS alergeni_status TEXT NOT NULL DEFAULT 'nepreverjeno',
  ADD COLUMN IF NOT EXISTS alergeni_vir TEXT,
  ADD COLUMN IF NOT EXISTS alergeni_opomba_vira TEXT,
  ADD COLUMN IF NOT EXISTS alergeni_document_id UUID REFERENCES documents(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS alergeni_verified_by TEXT,
  ADD COLUMN IF NOT EXISTS alergeni_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alergeni_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alergeni_hash TEXT;

ALTER TABLE prejemnice_postavke DROP CONSTRAINT IF EXISTS prejemnice_postavke_alergeni_status_check;
ALTER TABLE prejemnice_postavke ADD CONSTRAINT prejemnice_postavke_alergeni_status_check
  CHECK (alergeni_status IN ('nepreverjeno', 'potrjeno_brez', 'potrjeno'));
ALTER TABLE prejemnice_postavke DROP CONSTRAINT IF EXISTS prejemnice_postavke_alergeni_vir_check;
ALTER TABLE prejemnice_postavke ADD CONSTRAINT prejemnice_postavke_alergeni_vir_check
  CHECK (alergeni_vir IS NULL OR alergeni_vir IN ('etiketa', 'specifikacija', 'izjava_dobavitelja', 'normativ', 'rocno', 'drugo'));