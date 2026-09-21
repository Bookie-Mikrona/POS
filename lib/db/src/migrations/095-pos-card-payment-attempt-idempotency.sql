CREATE TABLE IF NOT EXISTS pos_karticna_placila_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  narocilo_id integer REFERENCES narocila(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('payten', 'sumup', 'viva_smart', 'viva_terminal')),
  znesek numeric(14, 2) NOT NULL,
  provider_referenca text,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'pending', 'completed', 'failed', 'unknown')),
  napaka text,
  rezultat_json text,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  posodobljeno timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_karticna_placila_attempt_key_unique
  ON pos_karticna_placila_attempt (company_id, enota_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS pos_karticna_placila_attempt_provider_reference_unique
  ON pos_karticna_placila_attempt (provider, provider_referenca);