-- Operational delivery lifecycle.  Kept separate from the order lifecycle:
-- `narocila.status` still describes the fiscal/open order, while this is the
-- physical delivery state.
CREATE TABLE IF NOT EXISTS dostavni_kurirji (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  ime text NOT NULL,
  telefon text,
  aktiven boolean NOT NULL DEFAULT true,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enota_id, ime)
);

ALTER TABLE narocila
  ADD COLUMN IF NOT EXISTS dostava_status text,
  ADD COLUMN IF NOT EXISTS dostava_kurir_id integer REFERENCES dostavni_kurirji(id) ON DELETE SET NULL;

-- Existing deliveries predate operational tracking and are therefore safely
-- initialized at receipt, never guessed as delivered.
UPDATE narocila
SET dostava_status = 'prejeto'
WHERE nacin_izpolnitve = 'dostava' AND dostava_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'narocila_dostava_status_check'
  ) THEN
    ALTER TABLE narocila ADD CONSTRAINT narocila_dostava_status_check CHECK (
      dostava_status IS NULL OR dostava_status IN
        ('prejeto', 'potrjeno', 'v_pripravi', 'pripravljeno', 'prevzel_kurir', 'dostavljeno', 'preklicano')
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS dostava_status_zgodovina (
  id bigserial PRIMARY KEY,
  narocilo_id integer NOT NULL REFERENCES narocila(id) ON DELETE CASCADE,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN
    ('prejeto', 'potrjeno', 'v_pripravi', 'pripravljeno', 'prevzel_kurir', 'dostavljeno', 'preklicano')),
  kurir_id integer REFERENCES dostavni_kurirji(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  actor_id integer,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  UNIQUE (narocilo_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_dostava_status_zgodovina_narocilo
  ON dostava_status_zgodovina(narocilo_id, id);
CREATE INDEX IF NOT EXISTS ix_dostavni_kurirji_enota_aktivni
  ON dostavni_kurirji(enota_id, aktiven);