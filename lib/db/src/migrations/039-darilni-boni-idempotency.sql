-- Strežniška idempotentnost za izdajo večnamenskih darilnih bonov.
-- Brez plačilne namere ponudnika terminalski ID ni dokaz plačila, je pa lahko
-- enkratna sled, ki prepreči ponovno uporabo iste SumUp/Viva reference.

CREATE TABLE IF NOT EXISTS darilni_bon_izdaje (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  placilna_nacin text NOT NULL CHECK (placilna_nacin IN ('gotovina', 'kartica')),
  znesek numeric(14, 2) NOT NULL,
  karticna_referenca text,
  terminalsko_placilo_preverjeno text NOT NULL DEFAULT 'nepreverjeno'
    CHECK (terminalsko_placilo_preverjeno IN ('nepreverjeno')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'failed')),
  racun_id integer REFERENCES racuni(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS darilni_bon_izdaje_company_key_unique
  ON darilni_bon_izdaje (company_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS darilni_bon_izdaje_company_card_ref_unique
  ON darilni_bon_izdaje (company_id, karticna_referenca);
CREATE UNIQUE INDEX IF NOT EXISTS darilni_bon_izdaje_racun_unique
  ON darilni_bon_izdaje (racun_id);