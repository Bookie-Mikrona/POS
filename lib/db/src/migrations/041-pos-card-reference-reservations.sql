-- Skupna atomska rezervacija SumUp/Viva reference pred FURS klicem.
-- Zapre sočasno ponovno uporabo med navadnim računom in darilnim bonom.

CREATE TABLE IF NOT EXISTS pos_karticna_placila_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('sumup', 'viva')),
  referenca text NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'used', 'failed')),
  racun_id integer REFERENCES racuni(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_karticna_placila_reference_unique
  ON pos_karticna_placila_reference (provider, referenca);
CREATE UNIQUE INDEX IF NOT EXISTS pos_karticna_placila_reference_racun_unique
  ON pos_karticna_placila_reference (racun_id);