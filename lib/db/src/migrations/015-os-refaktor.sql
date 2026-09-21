-- 015: Refaktor register OS — glava (osnovna_sredstva) + podzapisi (os_doknjizbe)
--
-- Obstoječa "flat" tabela osnovna_sredstva se zavrže in nadomesti z:
--   osnovna_sredstva (GLAVA) — skupni atributi: naziv, skupina, STM, konti, status
--   os_doknjizbe     (PODZAPISI) — vrednostna polja: nabavna vrednost, datumi, neamort.
--
-- DEV ONLY — v dev bazi ni produkcijskih podatkov, destruktivna migracija je varna.
-- Produkcije se NE dotikamo.
--
-- Logika doknjižbe:
--   seq=0 je osnovni nakup (ustvari se samodejno ob vnosu sredstva)
--   seq=1,2,3… so dograditve/naknadna vlaganja
--   Dograditev prevzame skupino in konte iz glave (ni jih na os_doknjizbe)
--   Vsaka dograditev se amortizira od svojega datum_aktivacije po skupini GLAVE (3c)

-- 1. Odstranjujemo staro flat tabelo (dev, ni podatkov vrednih ohranitve)
DROP TABLE IF EXISTS osnovna_sredstva CASCADE;

-- 2. Nova glava — SAMO skupni atributi, brez vrednostnih polj
CREATE TABLE IF NOT EXISTS osnovna_sredstva (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  inventarna_st        TEXT        NOT NULL,
  naziv                TEXT        NOT NULL,
  -- Skupni šifranti — določeni enkrat na glavi, doknjižbe jih PREVZAMEJO
  skupina_id           UUID        REFERENCES os_amortizacijske_skupine(id) ON DELETE RESTRICT,
  cost_center_id       UUID        REFERENCES cost_centers(id)              ON DELETE SET NULL,
  account_id           UUID        REFERENCES accounts(id)                  ON DELETE RESTRICT,
  konto_popravka_id    UUID        REFERENCES accounts(id)                  ON DELETE RESTRICT,
  konto_stroska_id     UUID        REFERENCES accounts(id)                  ON DELETE RESTRICT,
  -- Status celotnega sredstva (skupaj z vsemi doknjižbami)
  status               TEXT        NOT NULL DEFAULT 'v_teku'
    CONSTRAINT chk_os_status CHECK (status IN ('v_teku','v_uporabi','odpisano','izloceno')),
  opomba               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- inventarna_st je enolična znotraj podjetja (brez doknjizba v ključu)
  CONSTRAINT uq_os_inventarna UNIQUE (company_id, inventarna_st)
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

-- 3. Podzapisi — vrednostna polja, datumi, lastni status doknjižbe
--    seq=0 = osnovni nakup (vsako sredstvo ga mora imeti)
--    seq=1,2,3 = dograditve (naknadna vlaganja)
CREATE TABLE IF NOT EXISTS os_doknjizbe (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  sredstvo_id             UUID          NOT NULL
    REFERENCES osnovna_sredstva(id) ON DELETE CASCADE,
  -- Zaporedna številka: 0=osnova, 1,2,3=dograditve
  seq                     INTEGER       NOT NULL DEFAULT 0,
  -- Opis vlaganja — za seq=0 neobvezen; za dograditve priporočljiv
  naziv_vlaganja          TEXT,
  -- Vrednostna polja (vsaka doknjižba ima svojo vrednost)
  nabavna_vrednost        NUMERIC(14,2) NOT NULL,
  odpisana_vrednost       NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Delež nabavne vrednosti, ki se NE amortizira (0–100).
  -- Amortizirljiva osnova = nabavna_vrednost × (100 − neamortizljivi_del_pct) / 100
  neamortizljivi_del_pct  NUMERIC(5,2)  NOT NULL DEFAULT 0
    CONSTRAINT chk_doknjizba_neamort_pct
      CHECK (neamortizljivi_del_pct >= 0 AND neamortizljivi_del_pct <= 100),
  datum_nabave            DATE          NOT NULL,
  -- Ob vnosu sproži amortizacijo; NULL = investicija v teku
  datum_aktivacije        DATE,
  datum_izpisa            DATE,
  -- Status te doknjižbe (neodvisno od glave)
  status                  TEXT          NOT NULL DEFAULT 'v_teku'
    CONSTRAINT chk_doknjizba_status
      CHECK (status IN ('v_teku','v_uporabi','odpisano','izloceno')),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT uq_os_doknjizba_seq UNIQUE (sredstvo_id, seq)
);

CREATE INDEX IF NOT EXISTS ix_os_doknjizbe_sredstvo
  ON os_doknjizbe(sredstvo_id);
CREATE INDEX IF NOT EXISTS ix_os_doknjizbe_status
  ON os_doknjizbe(sredstvo_id, status);
