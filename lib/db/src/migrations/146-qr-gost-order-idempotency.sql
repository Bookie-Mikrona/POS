-- Public retries append no duplicate lines; an accepted submission is immutable.
CREATE TABLE IF NOT EXISTS qr_gost_narocila (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  miza_id integer NOT NULL REFERENCES mize(id) ON DELETE RESTRICT,
  qr_naprava_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  narocilo_id integer NOT NULL REFERENCES narocila(id) ON DELETE RESTRICT,
  ustvarjeno timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_qr_gost_narocila_retry
  ON qr_gost_narocila (enota_id, miza_id, qr_naprava_id, idempotency_key);
CREATE INDEX IF NOT EXISTS ix_qr_gost_narocila_narocilo
  ON qr_gost_narocila (narocilo_id);

-- Upgrade databases where the table was created by the initial version.
ALTER TABLE qr_gost_narocila ADD COLUMN IF NOT EXISTS request_fingerprint text;
UPDATE qr_gost_narocila SET request_fingerprint = '' WHERE request_fingerprint IS NULL;
ALTER TABLE qr_gost_narocila ALTER COLUMN request_fingerprint SET NOT NULL;