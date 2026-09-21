-- 025-os-oslabitev.sql
-- Oslabitev vrednosti OS (SRS 1.35+): ločena postavka na zaključenem letnem obračunu.
-- Vpliva na osnovo amortizacije naslednjega leta (N+1).
-- os_amortizacija_obracun_sredstvo.oslabitev = znesek oslabitve, vnesen na zaključen obračun leta N.

ALTER TABLE os_amortizacija_obracun_sredstvo
  ADD COLUMN IF NOT EXISTS oslabitev NUMERIC(14, 2) NOT NULL DEFAULT 0;
