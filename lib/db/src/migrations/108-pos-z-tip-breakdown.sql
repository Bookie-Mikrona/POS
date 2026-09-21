-- Snapshot the legal treatment selected when each receipt was issued. JSONB
-- keeps the closed-day breakdown immutable and extensible without overwriting
-- a historical Z when a company changes its tip policy.
ALTER TABLE z_porocila
  ADD COLUMN IF NOT EXISTS tip_breakdown jsonb NOT NULL DEFAULT
  '{"gross":0,"net":0,"vat":0,"cardFee":0,"liability":0,"revenue":0,"byPolicyMode":[]}'::jsonb;