-- CTI dohodni klici iz MacroDroida. Varno za večkratni zagon v razvoju/testih.
CREATE TABLE IF NOT EXISTS cti_dohodni_klici (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  telefon text NOT NULL,
  telefon_normaliziran text NOT NULL,
  prejeto timestamptz NOT NULL DEFAULT now(),
  obravnavano boolean NOT NULL DEFAULT false,
  narocnik_id integer REFERENCES narocniki(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_cti_dohodni_klici_enota_prejeto
  ON cti_dohodni_klici (enota_id, prejeto);