-- 029 — Skupen šifrant poslovnih partnerjev
-- POS shranjeni_kupci → skupna tabela counterparties (company-scope, ne enota-scope)
-- Vse enote istega podjetja + ERP moduli (Glavna knjiga, OS) delijo isti šifrant.

-- 1. Razširi counterparties z manjkajočimi POS polji
ALTER TABLE counterparties
  ADD COLUMN IF NOT EXISTS kratki_naziv        TEXT,
  ADD COLUMN IF NOT EXISTS ulica               TEXT,
  ADD COLUMN IF NOT EXISTS koda_drzave         TEXT,
  ADD COLUMN IF NOT EXISTS id_za_ddv           TEXT,
  ADD COLUMN IF NOT EXISTS trr                 JSONB,
  ADD COLUMN IF NOT EXISTS vrsta_partnerja     TEXT,
  ADD COLUMN IF NOT EXISTS kmg_mid             TEXT,
  ADD COLUMN IF NOT EXISTS e_racun_prejemnik   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS e_racun_omrezje     TEXT,
  ADD COLUMN IF NOT EXISTS e_racun_email       TEXT,
  ADD COLUMN IF NOT EXISTS e_racun_naslov      TEXT,
  ADD COLUMN IF NOT EXISTS e_racun_sifra_pu    TEXT,
  ADD COLUMN IF NOT EXISTS e_racun_bic         TEXT,
  ADD COLUMN IF NOT EXISTS stevilo_upor        INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS zadnja_uporaba      TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Shrani mapping shranjeni_kupci.id → nova UUID za counterparties
--    Vsak shranjeni_kupec dobi edinstveno UUID (brez deduplikacije med enotami).
--    Legacy ID je shranjen v pomocni tabeli za posodobitev FK-jev.
CREATE TABLE _sk_cp_mapping (
  stari_id  INTEGER PRIMARY KEY,
  novi_id   UUID    NOT NULL DEFAULT gen_random_uuid(),
  company_id UUID   NOT NULL
);

INSERT INTO _sk_cp_mapping (stari_id, company_id)
SELECT sk.id, e.company_id
FROM shranjeni_kupci sk
JOIN enote e ON e.id = sk.enota_id;

-- 3. Vstavi shranjeni_kupci → counterparties
INSERT INTO counterparties (
  id, company_id, type,
  name, kratki_naziv,
  tax_id, id_za_ddv, registration_number,
  vat_payer,
  address, ulica, post_code, city, country, koda_drzave,
  email, phone,
  iban, trr,
  vrsta_partnerja, kmg_mid,
  e_racun_prejemnik, e_racun_omrezje, e_racun_email,
  e_racun_naslov, e_racun_sifra_pu, e_racun_bic,
  stevilo_upor, zadnja_uporaba,
  is_active, payment_terms_days,
  created_at, updated_at
)
SELECT
  m.novi_id,
  m.company_id,
  'both'::counterparty_type,
  sk.naziv,
  sk.kratki_naziv,
  sk.davcna_stevilka,
  sk.id_za_ddv,
  sk.maticna_stevilka,
  COALESCE(sk.zavezanec_ddv, FALSE),
  sk.naslov,                        -- address = naslov (ERP style)
  sk.ulica,
  sk.postna_stevilka,
  sk.kraj,
  COALESCE(sk.drzava, 'Slovenija'),
  COALESCE(sk.koda_drzave, 'SI'),
  sk.email,
  sk.telefon,                       -- phone = telefon
  CASE
    WHEN sk.trr IS NOT NULL AND jsonb_typeof(sk.trr) = 'array' AND jsonb_array_length(sk.trr) > 0
    THEN (sk.trr -> 0 ->> 'iban')
    ELSE NULL
  END,
  sk.trr,
  sk.vrsta_partnerja,
  sk.kmg_mid,
  COALESCE(sk.e_racun_prejemnik, FALSE),
  sk.e_racun_omrezje,
  sk.e_racun_email,
  sk.e_racun_naslov,
  sk.e_racun_sifra_pu,
  sk.e_racun_bic,
  sk.stevilo_upor,
  sk.zadnja_uporaba,
  TRUE,
  30,
  sk.ustvarjeno,
  sk.posodobljeno
FROM shranjeni_kupci sk
JOIN _sk_cp_mapping m ON m.stari_id = sk.id;

-- 4. Posodobi partner_ceniki: kupec_id INTEGER → UUID (counterparties)
ALTER TABLE partner_ceniki
  ADD COLUMN kupec_uuid UUID REFERENCES counterparties(id) ON DELETE CASCADE;

UPDATE partner_ceniki pc
SET kupec_uuid = m.novi_id
FROM _sk_cp_mapping m
WHERE m.stari_id = pc.kupec_id;

-- Odstrani stari integer FK in constraint
ALTER TABLE partner_ceniki DROP CONSTRAINT IF EXISTS partner_ceniki_kupec_id_fkey;
DROP INDEX IF EXISTS partner_ceniki_kupec_artikel_uq;

ALTER TABLE partner_ceniki DROP COLUMN kupec_id;
ALTER TABLE partner_ceniki RENAME COLUMN kupec_uuid TO kupec_id;
ALTER TABLE partner_ceniki ALTER COLUMN kupec_id SET NOT NULL;
ALTER TABLE partner_ceniki ADD CONSTRAINT partner_ceniki_kupec_artikel_uq UNIQUE (kupec_id, artikel_id);

-- 5. Posodobi prejemnice: dobavitelj_id INTEGER → UUID (counterparties)
ALTER TABLE prejemnice
  ADD COLUMN dobavitelj_uuid UUID REFERENCES counterparties(id) ON DELETE SET NULL;

UPDATE prejemnice p
SET dobavitelj_uuid = m.novi_id
FROM _sk_cp_mapping m
WHERE m.stari_id = p.dobavitelj_id;

ALTER TABLE prejemnice DROP CONSTRAINT IF EXISTS prejemnice_dobavitelj_id_fkey;
ALTER TABLE prejemnice DROP COLUMN dobavitelj_id;
ALTER TABLE prejemnice RENAME COLUMN dobavitelj_uuid TO dobavitelj_id;

-- 6. Posodobi partner_eposta: partner_id INTEGER → UUID (counterparties)
ALTER TABLE partner_eposta
  ADD COLUMN partner_uuid UUID REFERENCES counterparties(id) ON DELETE CASCADE;

UPDATE partner_eposta pe
SET partner_uuid = m.novi_id
FROM _sk_cp_mapping m
WHERE m.stari_id = pe.partner_id;

ALTER TABLE partner_eposta DROP CONSTRAINT IF EXISTS partner_eposta_partner_id_fkey;
ALTER TABLE partner_eposta DROP COLUMN partner_id;
ALTER TABLE partner_eposta RENAME COLUMN partner_uuid TO partner_id;
ALTER TABLE partner_eposta ALTER COLUMN partner_id SET NOT NULL;

-- 7. Posodobi artikel_dobavitelj: dobavitelj_id INTEGER → UUID (counterparties)
ALTER TABLE artikel_dobavitelj
  ADD COLUMN dobavitelj_uuid UUID REFERENCES counterparties(id) ON DELETE CASCADE;

UPDATE artikel_dobavitelj ad
SET dobavitelj_uuid = m.novi_id
FROM _sk_cp_mapping m
WHERE m.stari_id = ad.dobavitelj_id;

ALTER TABLE artikel_dobavitelj DROP CONSTRAINT IF EXISTS artikel_dobavitelj_dobavitelj_id_fkey;
DROP INDEX IF EXISTS uq_ad_sifra;
DROP INDEX IF EXISTS uq_ad_gtin;

ALTER TABLE artikel_dobavitelj DROP COLUMN dobavitelj_id;
ALTER TABLE artikel_dobavitelj RENAME COLUMN dobavitelj_uuid TO dobavitelj_id;
ALTER TABLE artikel_dobavitelj ALTER COLUMN dobavitelj_id SET NOT NULL;

CREATE UNIQUE INDEX uq_ad_sifra ON artikel_dobavitelj (enota_id, dobavitelj_id, sifra_dobavitelja)
  WHERE sifra_dobavitelja IS NOT NULL;
CREATE UNIQUE INDEX uq_ad_gtin  ON artikel_dobavitelj (enota_id, dobavitelj_id, gtin)
  WHERE gtin IS NOT NULL;

-- 8. Posodobi uvoz_profil: dobavitelj_id INTEGER → UUID (counterparties)
ALTER TABLE uvoz_profil
  ADD COLUMN dobavitelj_uuid UUID REFERENCES counterparties(id) ON DELETE SET NULL;

UPDATE uvoz_profil up
SET dobavitelj_uuid = m.novi_id
FROM _sk_cp_mapping m
WHERE m.stari_id = up.dobavitelj_id;

ALTER TABLE uvoz_profil DROP CONSTRAINT IF EXISTS uvoz_profil_dobavitelj_id_fkey;
DROP INDEX IF EXISTS ix_profil_dobavitelj;

ALTER TABLE uvoz_profil DROP COLUMN dobavitelj_id;
ALTER TABLE uvoz_profil RENAME COLUMN dobavitelj_uuid TO dobavitelj_id;
-- dobavitelj_id je po novem nullable (uvozni profil brez dobavitelja)

CREATE INDEX ix_profil_dobavitelj ON uvoz_profil (enota_id, dobavitelj_id);

-- 9. Dodaj kupec_cp_id UUID na racuni (poleg obstoječega integer kupec_id za historiko)
ALTER TABLE racuni
  ADD COLUMN kupec_cp_id UUID REFERENCES counterparties(id) ON DELETE SET NULL;

UPDATE racuni r
SET kupec_cp_id = m.novi_id
FROM _sk_cp_mapping m
WHERE m.stari_id = r.kupec_id;

-- 10. Počisti pomožno tabelo
DROP TABLE _sk_cp_mapping;
