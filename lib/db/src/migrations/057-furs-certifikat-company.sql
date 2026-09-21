-- 057-furs-certifikat-company.sql
--
-- FURS certifikat je vezan na podjetje. Javni PEM je lahko v čistopisu,
-- zasebni ključ pa se shrani AES-256-GCM šifriran v furs_kljuc_enc.
-- Geslo .p12 se ne shranjuje.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS furs_certifikat_pem text,
  ADD COLUMN IF NOT EXISTS furs_kljuc_enc text,
  ADD COLUMN IF NOT EXISTS furs_cert_subject text,
  ADD COLUMN IF NOT EXISTS furs_cert_velja_do timestamptz;