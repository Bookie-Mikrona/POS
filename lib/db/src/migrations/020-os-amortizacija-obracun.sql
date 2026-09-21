-- Migration 020: OS amortizacija — mesečni obračun, ažuriranje, kartica, zaklep
-- Dve novi tabeli za shranjevanje izvršenega obračuna amortizacije po letu.
--
-- os_amortizacija_obracun (glava): ena vrstica na (company_id, leto)
--   status = 'odprt'  → do_meseca < 12 (delni obračun, zaklep naslednjega leta)
--   status = 'zakljucen' → do_meseca = 12 (celotno leto, dovoli naslednje leto)
--
-- os_amortizacija_obracun_sredstvo (vrstice): ena vrstica na (obracun_id, sredstvo_id)
--   ažurira se ob vsakem ponovnem zagonu istega leta

CREATE TABLE IF NOT EXISTS os_amortizacija_obracun (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  leto          INTEGER NOT NULL CHECK (leto >= 1990 AND leto <= 2100),
  do_meseca     INTEGER NOT NULL CHECK (do_meseca >= 1 AND do_meseca <= 12),
  status        TEXT NOT NULL DEFAULT 'odprt' CHECK (status IN ('odprt', 'zakljucen')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, leto)
);

CREATE TABLE IF NOT EXISTS os_amortizacija_obracun_sredstvo (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obracun_id    UUID NOT NULL REFERENCES os_amortizacija_obracun(id) ON DELETE CASCADE,
  sredstvo_id   UUID NOT NULL REFERENCES osnovna_sredstva(id) ON DELETE CASCADE,
  osnova        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  stopnja       NUMERIC(6, 3) NOT NULL DEFAULT 0,
  obracunano    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (obracun_id, sredstvo_id)
);

-- Indeks za hitro iskanje po sredstvo_id (kartica)
CREATE INDEX IF NOT EXISTS idx_os_amort_obr_sredstvo_sredstvo_id
  ON os_amortizacija_obracun_sredstvo(sredstvo_id);
