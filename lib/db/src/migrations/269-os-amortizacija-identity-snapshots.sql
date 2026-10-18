-- test-bootstrap: audit
-- Existing NULLs deliberately remain NULL: current register data is not history.
ALTER TABLE os_amortizacija_obracun
  ADD COLUMN IF NOT EXISTS company_snapshot jsonb;
ALTER TABLE os_amortizacija_obracun_sredstvo
  ADD COLUMN IF NOT EXISTS inventarna_st_snapshot text,
  ADD COLUMN IF NOT EXISTS naziv_snapshot text;
