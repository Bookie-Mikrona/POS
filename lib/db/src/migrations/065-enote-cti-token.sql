-- Enolični CTI žeton na enoto. Nullable omogoča enotam brez MacroDroid povezave.
ALTER TABLE enote
  ADD COLUMN IF NOT EXISTS cti_token text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_enote_cti_token
  ON enote (cti_token);