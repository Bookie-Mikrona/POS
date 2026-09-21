-- Migration 017: OS amortizacija nastavitve
-- Nastavljivi privzeti konti za knjiženje amortizacije (Faza 3c/2)
-- Vzorec: ddv_zakljucek_settings

CREATE TABLE IF NOT EXISTS os_amortizacija_nastavitve (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  -- Konto stroška amortizacije (npr. 430x) — v breme
  konto_stroska_id   UUID REFERENCES accounts(id) ON DELETE SET NULL,
  -- Konto popravka vrednosti OS (npr. 019x/029x/039x) — v dobro
  konto_popravka_id  UUID REFERENCES accounts(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
