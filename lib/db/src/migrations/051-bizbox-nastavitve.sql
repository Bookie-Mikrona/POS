-- 051-bizbox-nastavitve.sql
-- Per-podjetje šifrirane poverilnice za bizBox e-račun omrežje.
--
-- Geslo je shranjeno AES-256-GCM šifrirano (nikoli plaintext).
-- Ključ za dešifriranje: BIZBOX_ENC_KEY (Replit Secret).
-- En vnosek na podjetje (company_id UNIQUE = PRIMARY KEY).
--
-- Ob oddaji e-računa se bere najprej iz te tabele (per-podjetje),
-- fallback na okoljski spremenljivki BIZBOX_USER / BIZBOX_PASS.

CREATE TABLE IF NOT EXISTS bizbox_nastavitve (
  company_id   uuid    PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  bizbox_user  text    NOT NULL,
  -- AES-256-GCM šifropis v obliki base64(iv):base64(authTag):base64(ciphertext)
  bizbox_pass_enc text NOT NULL,
  bizbox_okolje   text NOT NULL DEFAULT 'test'
    CONSTRAINT bizbox_nastavitve_okolje_check CHECK (bizbox_okolje IN ('test', 'prod')),
  -- Override za pošiljateljev eDDress; NULL = vzame se podjetje_davcna iz companies
  posiljatelj_davcna text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
