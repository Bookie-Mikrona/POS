-- 028-os-dobavitelj.sql
-- Per-doknjižba: dobavitelj (FK na counterparties), številka in datum prejetega računa.
-- Dobaviteljevi podatki (naziv, taxId) se berejo iz counterparties prek JOIN — NE kopirajo.

ALTER TABLE os_doknjizbe
  ADD COLUMN IF NOT EXISTS partner_id   UUID REFERENCES counterparties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS st_racuna    TEXT,
  ADD COLUMN IF NOT EXISTS datum_racuna DATE;

COMMENT ON COLUMN os_doknjizbe.partner_id   IS 'FK na counterparties — dobavitelj za ta nakup/dograditev';
COMMENT ON COLUMN os_doknjizbe.st_racuna    IS 'Številka prejetega računa / nabavnega dokumenta';
COMMENT ON COLUMN os_doknjizbe.datum_racuna IS 'Datum prejetega računa (datum dokumenta)';
