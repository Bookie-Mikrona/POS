CREATE TABLE IF NOT EXISTS pos_racun_stevilke (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  poslovni_prostor text NOT NULL,
  blagajna_id text NOT NULL,
  last_value integer NOT NULL CHECK (last_value > 0),
  posodobljeno timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_racun_stevilke_scope_unique
  ON pos_racun_stevilke(enota_id, poslovni_prostor, blagajna_id);

CREATE UNIQUE INDEX IF NOT EXISTS racuni_enota_stevilka_unique
  ON racuni(enota_id, stevilka_racuna);