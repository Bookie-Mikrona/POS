-- 026-os-oslabitev-metoda.sql
-- Metoda obračuna oslabitve per sredstvo (SRS 1.35+):
--   1 = amortizacija od nabavne vrednosti (stopnja × NV) — skrajša dobo (privzeto)
--   2 = amortizacija od nove osnove po oslabitvi (effectivePreostalo × stopnja) — nižji letni znesek

ALTER TABLE os_amortizacija_obracun_sredstvo
  ADD COLUMN oslabitev_metoda INTEGER NOT NULL DEFAULT 1;

ALTER TABLE os_amortizacija_obracun_sredstvo
  ADD CONSTRAINT os_amortizacija_obracun_sredstvo_metoda_chk
    CHECK (oslabitev_metoda IN (1, 2));
