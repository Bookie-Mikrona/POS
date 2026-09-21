-- 037: blagajniški premiki, menjalni denar in konto 1109 Denar na poti.
-- Samo razvojna migracija; brez prenosa zgodovinskih podatkov.

ALTER TABLE pos_booking_settings
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cash_in_transit_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS blagajniske_nastavitve (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  blagajna_id integer NOT NULL REFERENCES blagajne(id) ON DELETE CASCADE,
  menjalni_denar numeric(14,2) NOT NULL DEFAULT 50.00,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blagajniske_nastavitve_company_enota_blagajna_unique
    UNIQUE (company_id, enota_id, blagajna_id)
);

CREATE TABLE IF NOT EXISTS blagajniski_premiki (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  blagajna_id integer NOT NULL REFERENCES blagajne(id) ON DELETE RESTRICT,
  poslovni_datum date NOT NULL,
  datum_cas timestamptz NOT NULL DEFAULT now(),
  tip text NOT NULL CHECK (tip IN (
    'IZPLACILO_DOBAVITELJU', 'POLOG_GOTOVINE', 'DVIG_GOTOVINE', 'POLOG_TRR', 'PRILIV_TRR', 'STORNO'
  )),
  status text NOT NULL DEFAULT 'OSNUTEK' CHECK (status IN ('OSNUTEK', 'POTRJEN', 'STORNIRAN')),
  znesek numeric(14,2) NOT NULL CHECK (znesek > 0),
  opis text NOT NULL,
  opomba text,
  partner_id uuid REFERENCES counterparties(id) ON DELETE RESTRICT,
  prejeti_racun_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  scenarij_pologa text CHECK (scenarij_pologa IN ('A', 'B')),
  razlog_izjeme_420 text,
  storno_od_id uuid REFERENCES blagajniski_premiki(id) ON DELETE RESTRICT,
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by text NOT NULL,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE blagajniski_premiki
  ADD CONSTRAINT blagajniski_premiki_storno_od_unique UNIQUE (storno_od_id);

CREATE INDEX IF NOT EXISTS ix_blagajniski_premiki_company_datum
  ON blagajniski_premiki(company_id, poslovni_datum);
CREATE INDEX IF NOT EXISTS ix_blagajniski_premiki_enota_blagajna_datum
  ON blagajniski_premiki(enota_id, blagajna_id, poslovni_datum);
CREATE INDEX IF NOT EXISTS ix_blagajniski_premiki_partner_datum
  ON blagajniski_premiki(partner_id, poslovni_datum);