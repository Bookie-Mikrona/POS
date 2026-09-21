-- Persistent, tenant-scoped kitchen display queue.  Tickets are a projection
-- of POS lines; events remain append-only for audit/recovery.
CREATE TABLE IF NOT EXISTS kds_postaje (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  ime text NOT NULL,
  aktivna boolean NOT NULL DEFAULT true,
  vrstni_red integer NOT NULL DEFAULT 0,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kds_postaje_ime_enota_unique UNIQUE (enota_id, ime)
);

CREATE TABLE IF NOT EXISTS kds_postaja_mapiranja (
  id serial PRIMARY KEY,
  postaja_id integer NOT NULL REFERENCES kds_postaje(id) ON DELETE CASCADE,
  kategorija_id integer REFERENCES kategorije(id) ON DELETE CASCADE,
  artikel_id integer REFERENCES artikli(id) ON DELETE CASCADE,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kds_postaja_mapiranja_target CHECK (kategorija_id IS NOT NULL OR artikel_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS kds_postaja_mapiranja_unique
  ON kds_postaja_mapiranja(postaja_id, COALESCE(kategorija_id, -1), COALESCE(artikel_id, -1));

CREATE TABLE IF NOT EXISTS kds_nalogi (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  postaja_id integer NOT NULL REFERENCES kds_postaje(id) ON DELETE RESTRICT,
  narocilo_id integer NOT NULL REFERENCES narocila(id) ON DELETE CASCADE,
  postavka_id integer NOT NULL REFERENCES postavke(id) ON DELETE CASCADE,
  stanje text NOT NULL DEFAULT 'aktivno' CHECK (stanje IN ('aktivno', 'bumped', 'ack')),
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  bumped_at timestamptz,
  ack_at timestamptz,
  CONSTRAINT kds_nalogi_postaja_postavka_unique UNIQUE (postaja_id, postavka_id)
);
CREATE INDEX IF NOT EXISTS ix_kds_nalogi_enota_postaja_aktivni
  ON kds_nalogi(enota_id, postaja_id, ustvarjeno) WHERE stanje = 'aktivno';

CREATE TABLE IF NOT EXISTS kds_dogodki (
  id bigserial PRIMARY KEY,
  nalog_id integer NOT NULL REFERENCES kds_nalogi(id) ON DELETE RESTRICT,
  zaporedje integer NOT NULL,
  tip text NOT NULL CHECK (tip IN ('materializiran', 'bump', 'ack')),
  idempotency_key text NOT NULL,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kds_dogodki_nalog_zaporedje_unique UNIQUE (nalog_id, zaporedje),
  CONSTRAINT kds_dogodki_nalog_idempotency_unique UNIQUE (nalog_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION prevent_kds_dogodek_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'kds events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS kds_dogodki_append_only ON kds_dogodki;
CREATE TRIGGER kds_dogodki_append_only BEFORE UPDATE OR DELETE ON kds_dogodki
FOR EACH ROW EXECUTE FUNCTION prevent_kds_dogodek_mutation();