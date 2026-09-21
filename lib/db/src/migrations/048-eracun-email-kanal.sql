-- 048-eracun-email-kanal.sql
--
-- e-poštni kanal za izdane e-račune:
--   1. e_racun_pdf         — base64-encoded PDF računa (generiran ob XML generiranju, ne vsakič znova)
--   2. e_racun_email_odgovor — sled e-poštnega pošiljanja (email naslov + rezultat)
--
-- Opomba: counterparties.e_racun_email je že dodan v migraciji 029-skupni-partnerji.sql
--         in v Drizzle shemi (lib/db/src/schema/counterparties.ts). Ni potrebne akcije.

ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS e_racun_pdf           text,   -- base64-encoded PDF
  ADD COLUMN IF NOT EXISTS e_racun_email_odgovor text;   -- sled e-poštnega pošiljanja

COMMENT ON COLUMN racuni.e_racun_pdf IS
  'base64-encoded PDF računa, generiran ob XML generiranju; za e-pošto in ZIP paket';
COMMENT ON COLUMN racuni.e_racun_email_odgovor IS
  'Sled e-poštnega pošiljanja: "OK: jan@firma.si" ali "NAPAKA: <msg>"';
