-- 029 recovery — nadaljuj od napake pri partner_ceniki
-- Zaženi SAMO enkrat, ko je 029-skupni-partnerji.sql padel pri partner_ceniki.

BEGIN;

-- ── partner_ceniki: dokonči zamenjavo kupec_id → UUID ─────────────────────────
-- kupec_uuid je že dodan in NULL za vse (ker ni bilo podatkov)
ALTER TABLE partner_ceniki DROP CONSTRAINT IF EXISTS partner_ceniki_kupec_artikel_uq;
ALTER TABLE partner_ceniki DROP CONSTRAINT IF EXISTS partner_ceniki_kupec_id_shranjeni_kupci_id_fk;
ALTER TABLE partner_ceniki DROP COLUMN kupec_id;
ALTER TABLE partner_ceniki RENAME COLUMN kupec_uuid TO kupec_id;
ALTER TABLE partner_ceniki ALTER COLUMN kupec_id SET NOT NULL;
ALTER TABLE partner_ceniki ADD CONSTRAINT partner_ceniki_kupec_artikel_uq UNIQUE (kupec_id, artikel_id);

-- ── prejemnice: dobavitelj_id INTEGER → UUID ──────────────────────────────────
ALTER TABLE prejemnice
  ADD COLUMN IF NOT EXISTS dobavitelj_uuid UUID REFERENCES counterparties(id) ON DELETE SET NULL;

UPDATE prejemnice p
SET dobavitelj_uuid = m.novi_id
FROM _sk_cp_mapping m
WHERE m.stari_id = p.dobavitelj_id;

ALTER TABLE prejemnice DROP CONSTRAINT IF EXISTS prejemnice_dobavitelj_id_fkey;
ALTER TABLE prejemnice DROP COLUMN dobavitelj_id;
ALTER TABLE prejemnice RENAME COLUMN dobavitelj_uuid TO dobavitelj_id;

-- ── partner_eposta: partner_id INTEGER → UUID ─────────────────────────────────
ALTER TABLE partner_eposta
  ADD COLUMN IF NOT EXISTS partner_uuid UUID REFERENCES counterparties(id) ON DELETE CASCADE;

UPDATE partner_eposta pe
SET partner_uuid = m.novi_id
FROM _sk_cp_mapping m
WHERE m.stari_id = pe.partner_id;

ALTER TABLE partner_eposta DROP CONSTRAINT IF EXISTS partner_eposta_partner_id_fkey;
ALTER TABLE partner_eposta DROP COLUMN partner_id;
ALTER TABLE partner_eposta RENAME COLUMN partner_uuid TO partner_id;
ALTER TABLE partner_eposta ALTER COLUMN partner_id SET NOT NULL;

-- ── artikel_dobavitelj: dobavitelj_id INTEGER → UUID ──────────────────────────
ALTER TABLE artikel_dobavitelj
  ADD COLUMN IF NOT EXISTS dobavitelj_uuid UUID REFERENCES counterparties(id) ON DELETE CASCADE;

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

-- ── uvoz_profil: dobavitelj_id INTEGER → UUID ─────────────────────────────────
ALTER TABLE uvoz_profil
  ADD COLUMN IF NOT EXISTS dobavitelj_uuid UUID REFERENCES counterparties(id) ON DELETE SET NULL;

UPDATE uvoz_profil up
SET dobavitelj_uuid = m.novi_id
FROM _sk_cp_mapping m
WHERE m.stari_id = up.dobavitelj_id;

ALTER TABLE uvoz_profil DROP CONSTRAINT IF EXISTS uvoz_profil_dobavitelj_id_fkey;
DROP INDEX IF EXISTS ix_profil_dobavitelj;

ALTER TABLE uvoz_profil DROP COLUMN dobavitelj_id;
ALTER TABLE uvoz_profil RENAME COLUMN dobavitelj_uuid TO dobavitelj_id;

CREATE INDEX ix_profil_dobavitelj ON uvoz_profil (enota_id, dobavitelj_id);

-- ── racuni: dodaj kupec_cp_id UUID ────────────────────────────────────────────
ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS kupec_cp_id UUID REFERENCES counterparties(id) ON DELETE SET NULL;

UPDATE racuni r
SET kupec_cp_id = m.novi_id
FROM _sk_cp_mapping m
WHERE m.stari_id = r.kupec_id;

-- ── Počisti pomožno tabelo ─────────────────────────────────────────────────────
DROP TABLE IF EXISTS _sk_cp_mapping;

COMMIT;
