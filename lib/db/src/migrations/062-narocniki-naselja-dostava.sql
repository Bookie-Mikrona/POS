-- Ločeni šifranti občanov, dostavnih naselij in dostavnih naslovov.
-- Idempotentno: varno za ponovitev v razvojnem in testnem predkoraku.

CREATE TABLE IF NOT EXISTS naselja (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  naziv text NOT NULL,
  oddaljenost_km numeric(8, 2),
  cena_dostave numeric(10, 2) NOT NULL DEFAULT 0,
  cas_dostave_min integer NOT NULL DEFAULT 0,
  aktivno boolean NOT NULL DEFAULT true,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  posodobljeno timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT naselja_oddaljenost_km_check CHECK (oddaljenost_km IS NULL OR oddaljenost_km >= 0),
  CONSTRAINT naselja_cena_dostave_check CHECK (cena_dostave >= 0),
  CONSTRAINT naselja_cas_dostave_min_check CHECK (cas_dostave_min >= 0)
);

CREATE INDEX IF NOT EXISTS ix_naselja_enota_aktivno
  ON naselja (enota_id, aktivno);

CREATE TABLE IF NOT EXISTS narocniki (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  ime text NOT NULL,
  telefon text NOT NULL,
  telefon_normaliziran text NOT NULL,
  email text,
  opombe text,
  stevilo_narocil integer NOT NULL DEFAULT 0,
  zadnje_narocilo timestamptz,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  posodobljeno timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT narocniki_stevilo_narocil_check CHECK (stevilo_narocil >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_narocniki_enota_telefon_normaliziran
  ON narocniki (enota_id, telefon_normaliziran);

CREATE INDEX IF NOT EXISTS ix_narocniki_enota_telefon_normaliziran
  ON narocniki (enota_id, telefon_normaliziran);

CREATE TABLE IF NOT EXISTS narocnik_naslovi (
  id serial PRIMARY KEY,
  narocnik_id integer NOT NULL REFERENCES narocniki(id) ON DELETE CASCADE,
  ulica text NOT NULL,
  hisna_stevilka text NOT NULL,
  vhod text,
  nadstropje text,
  naselje_id integer NOT NULL REFERENCES naselja(id) ON DELETE RESTRICT,
  navodilo text,
  privzet boolean NOT NULL DEFAULT false,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  posodobljeno timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_narocnik_naslovi_narocnik_id
  ON narocnik_naslovi (narocnik_id);

CREATE INDEX IF NOT EXISTS ix_narocnik_naslovi_naselje_id
  ON narocnik_naslovi (naselje_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_narocnik_naslovi_en_privzet
  ON narocnik_naslovi (narocnik_id)
  WHERE privzet = true;