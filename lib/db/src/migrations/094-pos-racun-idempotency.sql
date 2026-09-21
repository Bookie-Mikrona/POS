CREATE TABLE IF NOT EXISTS pos_racun_izdaja_zahteve (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  narocilo_id integer NOT NULL REFERENCES narocila(id) ON DELETE RESTRICT,
  blagajna_kljuc text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'unknown')),
  racun_id integer REFERENCES racuni(id) ON DELETE RESTRICT,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  posodobljeno timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_racun_izdaja_idempotency_unique
  ON pos_racun_izdaja_zahteve(company_id, enota_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS pos_racun_izdaja_blagajna_processing_unique
  ON pos_racun_izdaja_zahteve(enota_id, blagajna_kljuc)
  WHERE status = 'processing';