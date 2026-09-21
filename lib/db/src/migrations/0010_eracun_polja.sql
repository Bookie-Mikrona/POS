-- lib/db/src/migrations/0010_eracun_polja.sql
--
-- Faza A: Izhodni e-račun (e-SLOG 2.0 / UBL 2.1).
-- Tabeli racuni dodamo štiri polja za shranjevanje generiranega XML-a
-- in statusa pošiljanja.
--
-- Migracija je idempotentna (ADD COLUMN IF NOT EXISTS) in varna za
-- ponovni zagon.

ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS e_racun_xml     text,
  ADD COLUMN IF NOT EXISTS e_racun_status  text CHECK (e_racun_status IN ('pripravljen', 'poslan', 'napaka')),
  ADD COLUMN IF NOT EXISTS e_racun_datum   timestamptz,
  ADD COLUMN IF NOT EXISTS e_racun_napaka  text;

-- Indeks za hitro iskanje računov, ki čakajo na pošiljanje
CREATE INDEX IF NOT EXISTS ix_racuni_eracun_status
  ON racuni (e_racun_status)
  WHERE e_racun_status IS NOT NULL;
