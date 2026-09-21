-- 014: Register osnovnih sredstev (Faza 3a–3b)
-- Tabeli:
--   os_amortizacijske_skupine  — šifrant amortizacijskih skupin (edini nov šifrant, specifičen za OS)
--   osnovna_sredstva            — register sredstev
--
-- Vezave na obstoječe skupne šifrante:
--   cost_centers  (stroškovna mesta — obstoječa tabela, ne ustvarjamo novega šifranta)
--   accounts      (kontni načrt — obstoječa tabela)
--   companies     (cascade)
--
-- Ta korak NE vsebuje amortizacijskega obračuna niti knjižb v glavno knjigo.

-- ─── Amortizacijske skupine ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS os_amortizacijske_skupine (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  koda                 TEXT        NOT NULL,
  naziv                TEXT        NOT NULL,
  -- Računovodska stopnja (letna %, npr. 10.000 = 10 %)
  -- TODO: prihodnja izboljšava — leto-verzioniranje stopenj (ista koda, različna stopnja po letih);
  --       za to različico vodimo eno stopnjo na skupino.
  racunovodska_stopnja NUMERIC(6,3) NOT NULL,
  -- Davčna stopnja je ločena od računovodske (zakonita razlika);
  -- privzeto se ob vnosu nastavi na enako vrednost kot računovodska, urejljivo.
  davcna_stopnja       NUMERIC(6,3) NOT NULL,
  aktivno              BOOLEAN     NOT NULL DEFAULT true,
  opomba               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_os_skupina_koda UNIQUE (company_id, koda)
);

-- ─── Register osnovnih sredstev ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS osnovna_sredstva (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Inventarna številka + doknjižba tvorita enolični par znotraj podjetja.
  -- doknjižba = 0 za osnovno sredstvo; > 0 za naknadna vlaganja v isto sredstvo.
  inventarna_st           TEXT         NOT NULL,
  doknjizba               INTEGER      NOT NULL DEFAULT 0,
  naziv                   TEXT         NOT NULL,
  -- Vezava na OBSTOJEČI šifrant amortizacijskih skupin
  skupina_id              UUID         REFERENCES os_amortizacijske_skupine(id) ON DELETE RESTRICT,
  -- Vezava na OBSTOJEČ šifrant stroškovnih mest (NE ustvarjamo novega STM šifranta)
  cost_center_id          UUID         REFERENCES cost_centers(id)  ON DELETE SET NULL,
  -- Vezava na OBSTOJEČ kontni načrt
  account_id              UUID         REFERENCES accounts(id)      ON DELETE RESTRICT,
  konto_popravka_id       UUID         REFERENCES accounts(id)      ON DELETE RESTRICT,
  konto_stroska_id        UUID         REFERENCES accounts(id)      ON DELETE RESTRICT,
  -- Vrednosti
  nabavna_vrednost        NUMERIC(14,2) NOT NULL,
  odpisana_vrednost       NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Delež nabavne vrednosti, ki se NE amortizira (0–100; npr. 100 za zemljišče).
  -- Amortizirljiva osnova = nabavna_vrednost × (100 − neamortizljivi_del_pct) / 100.
  neamortizljivi_del_pct  NUMERIC(5,2)  NOT NULL DEFAULT 0
    CONSTRAINT chk_neamort_pct CHECK (neamortizljivi_del_pct >= 0 AND neamortizljivi_del_pct <= 100),
  -- Datumi
  datum_nabave            DATE         NOT NULL,
  datum_aktivacije        DATE,      -- ob vnosu sproži amortizacijo; NULL = investicija v teku
  datum_izpisa            DATE,      -- ustavi/izloči sredstvo
  -- Status: 'v_teku' = investicija v teku (brez amortizacije)
  status                  TEXT         NOT NULL DEFAULT 'v_teku'
    CONSTRAINT chk_os_status CHECK (status IN ('v_teku','v_uporabi','odpisano','izloceno')),
  leto_obracuna           INTEGER,
  opomba                  TEXT,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_os_inventarna UNIQUE (company_id, inventarna_st, doknjizba)
);

CREATE INDEX IF NOT EXISTS ix_osnovna_sredstva_company
  ON osnovna_sredstva(company_id);

CREATE INDEX IF NOT EXISTS ix_osnovna_sredstva_skupina
  ON osnovna_sredstva(skupina_id)
  WHERE skupina_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_osnovna_sredstva_cost_center
  ON osnovna_sredstva(cost_center_id)
  WHERE cost_center_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_osnovna_sredstva_status
  ON osnovna_sredstva(company_id, status);
