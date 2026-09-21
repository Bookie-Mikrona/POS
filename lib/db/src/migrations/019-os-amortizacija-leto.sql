-- Migration 019: OS amortizacija — lastno leto modula
-- Doda os_leto (integer, nullable) na os_amortizacija_nastavitve.
-- To je LASTNO OS obdobje, NEODVISNO od accounting_periods glavne knjige.
-- Moduli delajo v različnih letih hkrati (OS ima svoje, GLK svoje, POS svoje).

ALTER TABLE os_amortizacija_nastavitve
  ADD COLUMN IF NOT EXISTS os_leto INTEGER;
