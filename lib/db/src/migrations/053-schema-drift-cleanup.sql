-- 053-schema-drift-cleanup.sql
--
-- Počisti objekte iz DB, ki jih Drizzle shema ne pozna več:
--   1. Začasni backup tabeli (os_odpisana_backup_2024fix, _sk_cp_mapping)
--   2. Opuščeni stolpci v pos_booking_settings (b2c/lastrepr counterparty)
--   3. Opuščen stolpec partner_ceniki.kupec_uuid (zamenjal ga je kupec_id)
--
-- Pred brisanjem preverjeno: vsi stolpci imajo samo NULL vrednosti.
-- Backup tabeli sta bili ustvarjeni kot začasni pripomoček (2024) in nista
-- del aktivnega podatkovnega modela.

-- 1. Backup tabeli (brez aktivnih podatkov v poslovnem smislu)
DROP TABLE IF EXISTS os_odpisana_backup_2024fix;
DROP TABLE IF EXISTS _sk_cp_mapping;

-- 2. Opuščeni counterparty FK stolpci v pos_booking_settings
--    (B2C in lastna poraba counterparty sta bila odstranjena iz modela)
ALTER TABLE pos_booking_settings
  DROP COLUMN IF EXISTS pos_b2c_counterparty_id,
  DROP COLUMN IF EXISTS pos_lastrepr_counterparty_id;

-- 3. Opuščen kupec_uuid stolpec (zamenjal ga je kupec_id integer FK)
ALTER TABLE partner_ceniki
  DROP COLUMN IF EXISTS kupec_uuid;
