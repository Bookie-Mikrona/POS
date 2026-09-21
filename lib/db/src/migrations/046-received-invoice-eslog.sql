-- KORAK 6B: zgodovinsko verni podatki prejetega računa za e-SLOG izvoz.
-- Vsa nova polja so nullable, da stare prejemnice in dobavnice ostanejo veljavne.

DO $$ BEGIN
  CREATE TYPE prejemnica_vrsta_dokumenta AS ENUM ('RACUN', 'DOBAVNICA', 'DOBROPIS', 'BREMEPIS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE prejemnice
  ADD COLUMN IF NOT EXISTS vrsta_dokumenta prejemnica_vrsta_dokumenta,
  ADD COLUMN IF NOT EXISTS datum_dobave date,
  ADD COLUMN IF NOT EXISTS datum_opravljene_storitve date,
  ADD COLUMN IF NOT EXISTS bruto_skupaj numeric(14,2),
  ADD COLUMN IF NOT EXISTS placilni_nacin text,
  ADD COLUMN IF NOT EXISTS placilni_sklic text,
  ADD COLUMN IF NOT EXISTS dobavitelj_naziv text,
  ADD COLUMN IF NOT EXISTS dobavitelj_davcna text,
  ADD COLUMN IF NOT EXISTS dobavitelj_id_ddv text,
  ADD COLUMN IF NOT EXISTS dobavitelj_maticna text,
  ADD COLUMN IF NOT EXISTS dobavitelj_ulica text,
  ADD COLUMN IF NOT EXISTS dobavitelj_posta text,
  ADD COLUMN IF NOT EXISTS dobavitelj_kraj text,
  ADD COLUMN IF NOT EXISTS dobavitelj_drzava text,
  ADD COLUMN IF NOT EXISTS dobavitelj_iban text,
  ADD COLUMN IF NOT EXISTS dobavitelj_bic text,
  ADD COLUMN IF NOT EXISTS prejemnik_naziv text,
  ADD COLUMN IF NOT EXISTS prejemnik_davcna text,
  ADD COLUMN IF NOT EXISTS prejemnik_id_ddv text,
  ADD COLUMN IF NOT EXISTS prejemnik_naslov text,
  ADD COLUMN IF NOT EXISTS prejemnik_drzava text,
  ADD COLUMN IF NOT EXISTS snapshot_zajet timestamptz;

ALTER TABLE prejemnice_postavke
  ADD COLUMN IF NOT EXISTS enota_mere text,
  ADD COLUMN IF NOT EXISTS neto_cena numeric(15,6),
  ADD COLUMN IF NOT EXISTS neto_znesek numeric(14,2),
  ADD COLUMN IF NOT EXISTS ddv_kategorija text;

COMMENT ON COLUMN prejemnice.snapshot_zajet IS
  'Čas nespremenljivega posnetka dobavitelja in prejemnika ob nastanku prejemnice.';
COMMENT ON COLUMN prejemnice.vrsta_dokumenta IS
  'Vrsta dobaviteljevega dokumenta; samo RACUN je kandidat za e-SLOG Invoice izvoz.';