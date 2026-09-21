-- 012: DDV zaključek nastavitve — konti za neto DDV obveznost/terjatev
-- Idempotentno: CREATE TABLE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS ddv_zakljucek_settings (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                   UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  -- Konto za neto DDV obveznost (npr. 2699 — Obveznosti za DDV do FURS)
  neto_obveznost_account_id    UUID REFERENCES accounts(id) ON DELETE SET NULL,
  -- Konto za neto DDV terjatev/presežek (npr. 1699 — Terjatve za DDV od FURS)
  neto_terjatev_account_id     UUID REFERENCES accounts(id) ON DELETE SET NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
